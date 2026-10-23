import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import type { DbClient } from "@/db/client";
import {
  menuImportItems,
  menuImportPages,
  menuImports,
} from "@/db/schema";
import { getExtractionConfig } from "@/lib/env";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { extractMenuItems } from "@/lib/extraction/openai";
import { buildChangeType, normalizeName } from "../import-rules";
import { requireDraftEditable } from "../menu-access";
import { loadMenuTree, type MenuTreeItem } from "../menu-tree";
import { readPrivateObject } from "../storage";
import {
  ALLOWED_SOURCE_MIME,
  MAX_PROCESSING_ATTEMPTS,
  MAX_SOURCE_BYTES,
  STALE_PROCESSING_MS,
} from "./constants";

class LostImportClaimError extends Error {}

export async function processMenuImport(
  db: DbClient,
  actorId: string,
  importId: string,
): Promise<void> {
  const [row] = await db
    .select({ menuImport: menuImports })
    .from(menuImports)
    .where(eq(menuImports.id, importId))
    .limit(1);
  if (!row) throw new NotFoundError("Import not found.");
  if (!row.menuImport.menuId) {
    throw new ConflictError("This import is not linked to a draft menu.");
  }

  const { access, menu } = await requireDraftEditable(
    db,
    actorId,
    row.menuImport.menuId,
  );
  const config = getExtractionConfig();
  if (!config) {
    throw new ConflictError(
      "Menu extraction is not configured. Add an extraction provider and API key, or enter items manually.",
    );
  }
  if (
    row.menuImport.status !== "uploaded" &&
    row.menuImport.status !== "failed" &&
    row.menuImport.status !== "processing"
  ) {
    throw new ConflictError(
      "This import cannot be processed again. Upload a new scan to re-extract.",
    );
  }
  if (row.menuImport.attemptCount >= MAX_PROCESSING_ATTEMPTS) {
    throw new ConflictError(
      "This import has reached the retry limit. Upload a new scan to try again.",
    );
  }

  const pages = await db
    .select()
    .from(menuImportPages)
    .where(eq(menuImportPages.importId, importId))
    .orderBy(asc(menuImportPages.pageNumber));
  if (pages.length === 0) {
    throw new ConflictError("This import has no pages to process.");
  }
  if (pages.length > config.maxPages) {
    throw new ValidationError(
      `This import has ${pages.length} pages, but the extraction provider accepts at most ${config.maxPages}.`,
    );
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS);
  const processingToken = randomUUID();
  const claimed = await db
    .update(menuImports)
    .set({
      status: "processing",
      processingToken,
      processingStartedAt: now,
      lastAttemptAt: now,
      attemptCount: sql`${menuImports.attemptCount} + 1`,
      errorDetails: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(menuImports.id, importId),
        or(
          inArray(menuImports.status, ["uploaded", "failed"]),
          and(
            eq(menuImports.status, "processing"),
            or(
              isNull(menuImports.processingStartedAt),
              lt(menuImports.processingStartedAt, staleBefore),
            ),
          ),
        ),
      ),
    )
    .returning({ id: menuImports.id });
  if (claimed.length === 0) {
    throw new ConflictError("This import is already being processed.");
  }
  try {
    await db
      .update(menuImportPages)
      .set({ processingStatus: "processing", updatedAt: now })
      .where(eq(menuImportPages.importId, importId));

    const images: { dataUrl: string }[] = [];
    for (const page of pages) {
      const buffer = await readPrivateObject(page.privateSourceObjectKey);
      if (buffer.length > MAX_SOURCE_BYTES) {
        throw new ValidationError(
          "Each scan page must be 8 MB or smaller.",
        );
      }
      const detected = await fileTypeFromBuffer(buffer);
      if (!detected || !ALLOWED_SOURCE_MIME.has(detected.mime)) {
        throw new ValidationError(
          "Scan pages must be JPEG, PNG, or WebP images.",
        );
      }
      const normalized = await sharp(buffer, {
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .resize({
          width: 2200,
          height: 2200,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 85 })
        .toBuffer();
      images.push({
        dataUrl: `data:image/jpeg;base64,${normalized.toString("base64")}`,
      });
    }

    const result = await extractMenuItems(config, images);

    const tree = await loadMenuTree(db, menu.id);
    if (!tree) throw new NotFoundError("Target menu not found.");

    const existingByName = new Map<string, MenuTreeItem>();
    const existingByCategoryAndName = new Map<string, MenuTreeItem>();
    for (const category of tree.categories) {
      for (const item of category.items) {
        existingByName.set(normalizeName(item.name), item);
        existingByCategoryAndName.set(
          `${normalizeName(category.name)}|${normalizeName(item.name)}`,
          item,
        );
      }
    }

    const firstByName = new Map<string, string>();
    const processedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .delete(menuImportItems)
        .where(eq(menuImportItems.importId, importId));

      for (const [index, item] of result.items.entries()) {
        const key = normalizeName(item.name);
        const existing =
          existingByCategoryAndName.get(
            `${normalizeName(item.categoryName)}|${key}`,
          ) ?? existingByName.get(key);
        const duplicateOf = firstByName.get(key) ?? null;
        const changeType = buildChangeType(item, existing);
        const pricedVariant = item.variants.some(
          (variant) => variant.priceMinor !== null,
        );
        const needsReview =
          item.confidence < 70 ||
          (item.basePriceMinor === null && !pricedVariant) ||
          duplicateOf !== null ||
          changeType !== "unchanged";

        const [inserted] = await tx
          .insert(menuImportItems)
          .values({
            importId,
            pageNumber: item.pageNumber,
            categoryName: item.categoryName,
            name: item.name,
            description: item.description,
            basePriceMinor: item.basePriceMinor,
            currency: access.restaurant.currency,
            variants: item.variants,
            modifiers: item.modifiers,
            availabilityStatus: item.availabilityStatus,
            confidence: item.confidence,
            needsReview,
            duplicateOfImportItemId: duplicateOf,
            matchedMenuItemId: existing?.id ?? null,
            matchedLogicalId: existing?.logicalId ?? null,
            changeType,
            decision: "pending",
            sortOrder: index * 10,
            createdAt: processedAt,
            updatedAt: processedAt,
          })
          .returning({ id: menuImportItems.id });

        if (inserted && !firstByName.has(key)) {
          firstByName.set(key, inserted.id);
        }
      }

      const [finished] = await tx
        .update(menuImports)
        .set({
          status: "needs_review",
          extractionProvider: `${config.provider}:${config.model}`,
          processingToken: null,
          processingStartedAt: null,
          updatedAt: processedAt,
        })
        .where(
          and(
            eq(menuImports.id, importId),
            eq(menuImports.processingToken, processingToken),
          ),
        )
        .returning({ id: menuImports.id });
      if (!finished) throw new LostImportClaimError();

      await tx
        .update(menuImportPages)
        .set({
          processingStatus: "processed",
          extractionMetadata: {
            provider: config.provider,
            model: config.model,
            extractedAt: processedAt.toISOString(),
          },
          updatedAt: processedAt,
        })
        .where(eq(menuImportPages.importId, importId));
    });
  } catch (error) {
    if (error instanceof LostImportClaimError) {
      throw new ConflictError(
        "This import was reclaimed by another process. Refresh to see its status.",
      );
    }

    const message =
      error instanceof ValidationError
        ? error.message
        : "Menu extraction failed. Check the provider configuration and try again.";
    console.error("[imports] Menu import failed.", importId, error);

    const [owned] = await db
      .select({ id: menuImports.id })
      .from(menuImports)
      .where(
        and(
          eq(menuImports.id, importId),
          eq(menuImports.processingToken, processingToken),
        ),
      )
      .limit(1);
    if (!owned) {
      throw new ConflictError(
        "This import was reclaimed by another process. Refresh to see its status.",
      );
    }

    let cleanupIncomplete = false;
    try {
      await db
        .delete(menuImportItems)
        .where(eq(menuImportItems.importId, importId));
    } catch (cleanupError) {
      cleanupIncomplete = true;
      console.error(
        `[imports] Could not clear staged items for failed import ${importId}. Original failure: ${message}`,
        cleanupError,
      );
    }

    await db
      .update(menuImports)
      .set({
        status: "failed",
        errorDetails: cleanupIncomplete
          ? { message, cleanupIncomplete: true }
          : { message },
        processingToken: null,
        processingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(menuImports.id, importId),
          eq(menuImports.processingToken, processingToken),
        ),
      );
    await db
      .update(menuImportPages)
      .set({ processingStatus: "failed", updatedAt: new Date() })
      .where(eq(menuImportPages.importId, importId));
    throw new ConflictError(message);
  }
}
