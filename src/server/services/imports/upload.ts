import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";

import type { DbClient } from "@/db/client";
import { menuImportPages, menuImports } from "@/db/schema";
import { getExtractionConfig } from "@/lib/env";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { requireDraftEditable } from "../menu-access";
import {
  buildObjectKey,
  deletePrivateObject,
  getSignedPrivatePutUrl,
  headPrivateObject,
  isPrivateStorageConfigured,
  readPrivateObject,
} from "../storage";
import { ALLOWED_SOURCE_MIME, MAX_SOURCE_BYTES } from "./constants";
import { getMenuImport } from "./queries";

export type ImportUploadFile = {
  name: string;
  size: number;
  type: string;
};

export type BeginImportResult = {
  importId: string;
  uploads: {
    pageNumber: number;
    key: string;
    contentType: string;
    url: string;
  }[];
};

function validateUploadFiles(
  files: ImportUploadFile[],
  maxPages: number,
): { extension: string; contentType: string; sizeBytes: number }[] {
  if (files.length === 0) {
    throw new ValidationError("Choose at least one menu image to scan.");
  }
  if (files.length > maxPages) {
    throw new ValidationError(`Upload at most ${maxPages} page images at once.`);
  }

  return files.map((file) => {
    if (!file.name || file.size <= 0) {
      throw new ValidationError("One of the selected files is empty.");
    }
    if (file.size > MAX_SOURCE_BYTES) {
      throw new ValidationError("Each scan page must be 8 MB or smaller.");
    }
    const extension = ALLOWED_SOURCE_MIME.get(file.type);
    if (!extension) {
      throw new ValidationError(
        "Scan pages must be JPEG, PNG, or WebP images.",
      );
    }
    return { extension, contentType: file.type, sizeBytes: file.size };
  });
}

export async function beginMenuImport(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  menuId: string,
  files: ImportUploadFile[],
): Promise<BeginImportResult> {
  const { access, menu } = await requireDraftEditable(db, actorId, menuId);
  if (access.restaurant.id !== restaurantId) {
    throw new NotFoundError("Menu not found.");
  }
  if (!isPrivateStorageConfigured()) {
    throw new ConflictError(
      "Private scan storage is not configured. Set R2_PRIVATE_BUCKET first.",
    );
  }

  const config = getExtractionConfig();
  const maxPages = config?.maxPages ?? 10;
  const validated = validateUploadFiles(files, maxPages);
  const importId = randomUUID();
  const now = new Date();
  const prepared = validated.map((file, index) => ({
    pageNumber: index + 1,
    key: buildObjectKey(`imports/${importId}/page-${index + 1}`, file.extension),
    mimeType: file.contentType,
    sizeBytes: file.sizeBytes,
  }));

  await db.transaction(async (tx) => {
    await tx.insert(menuImports).values({
      id: importId,
      restaurantId,
      menuId: menu.id,
      uploadedBy: access.actor.id,
      status: "uploading",
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(menuImportPages).values(
      prepared.map((page) => ({
        importId,
        pageNumber: page.pageNumber,
        privateSourceObjectKey: page.key,
        mimeType: page.mimeType,
        sizeBytes: page.sizeBytes,
        processingStatus: "pending" as const,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });

  try {
    const uploads = await Promise.all(
      prepared.map(async (page) => ({
        pageNumber: page.pageNumber,
        key: page.key,
        contentType: page.mimeType,
        url: await getSignedPrivatePutUrl(page.key, page.mimeType),
      })),
    );
    return { importId, uploads };
  } catch (error) {
    await Promise.all(
      prepared.map((page) => deletePrivateObject(page.key)),
    );
    await db.delete(menuImports).where(eq(menuImports.id, importId));
    throw error;
  }
}

export async function confirmMenuImport(
  db: DbClient,
  actorId: string,
  importId: string,
): Promise<void> {
  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  if (data.import.status === "uploaded") return;
  if (data.import.status !== "uploading") {
    throw new ConflictError("This import is not awaiting an upload.");
  }
  if (data.pages.length === 0) {
    throw new ConflictError("This import has no pages to confirm.");
  }

  const now = new Date();
  try {
    for (const page of data.pages) {
      const head = await headPrivateObject(page.privateSourceObjectKey);
      if (
        head.contentLength === null ||
        head.contentLength <= 0 ||
        head.contentLength > MAX_SOURCE_BYTES
      ) {
        throw new ValidationError(
          "Each scan page must be a non-empty image up to 8 MB.",
        );
      }
      if (!head.contentType || !ALLOWED_SOURCE_MIME.has(head.contentType)) {
        throw new ValidationError(
          "Scan pages must be JPEG, PNG, or WebP images.",
        );
      }

      const buffer = await readPrivateObject(page.privateSourceObjectKey);
      const detected = await fileTypeFromBuffer(buffer);
      if (!detected || !ALLOWED_SOURCE_MIME.has(detected.mime)) {
        throw new ValidationError(
          "Scan pages must be JPEG, PNG, or WebP images.",
        );
      }
    }

    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(menuImports)
        .set({
          status: "uploaded",
          uploadCompletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(menuImports.id, importId),
            eq(menuImports.status, "uploading"),
          ),
        )
        .returning({ id: menuImports.id });
      if (!updated) {
        throw new ConflictError("This import is no longer awaiting an upload.");
      }

      await tx
        .update(menuImportPages)
        .set({ processingStatus: "uploaded", updatedAt: now })
        .where(eq(menuImportPages.importId, importId));
    });
  } catch (error) {
    await Promise.all(
      data.pages.map((page) =>
        deletePrivateObject(page.privateSourceObjectKey),
      ),
    );
    await db
      .update(menuImports)
      .set({
        status: "failed",
        errorDetails: {
          message:
            error instanceof ValidationError
              ? error.message
              : "The uploaded scan pages could not be verified.",
        },
        updatedAt: new Date(),
      })
      .where(eq(menuImports.id, importId));
    await db
      .update(menuImportPages)
      .set({ processingStatus: "failed", updatedAt: new Date() })
      .where(eq(menuImportPages.importId, importId));
    if (error instanceof ValidationError) throw error;
    throw new ConflictError("The uploaded scan pages could not be verified.");
  }
}
