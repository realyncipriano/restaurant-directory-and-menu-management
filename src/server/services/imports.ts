import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import type { DbClient } from "@/db/client";
import {
  menuCategories,
  menuImportItems,
  menuImportPages,
  menuImports,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { getExtractionConfig } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { parsePriceToMinor } from "@/lib/money";
import { extractMenuItems } from "@/lib/extraction/openai";
import { writeAuditLog } from "./audit";
import {
  getMenuAccess,
  lockDraftMenu,
  requireDraftEditable,
} from "./menu-access";
import { requireRestaurantPermission } from "./restaurant-access";
import {
  loadMenuTree,
  type MenuTreeCategory,
  type MenuTreeItem,
} from "./menu-tree";
import {
  buildObjectKey,
  deletePrivateObject,
  getSignedPrivatePutUrl,
  headPrivateObject,
  isPrivateStorageConfigured,
  readPrivateObject,
} from "./storage";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const MAX_PROCESSING_ATTEMPTS = 3;

class LostImportClaimError extends Error {}
const ALLOWED_SOURCE_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function itemPriceKey(item: MenuTreeItem): string {
  return JSON.stringify({
    base: item.basePriceMinor,
    variants: item.variants.map((variant) => [
      normalizeName(variant.name),
      variant.priceMinor,
    ]),
  });
}

type ImportItemRow = typeof menuImportItems.$inferSelect;

function importItemHasPrice(item: ImportItemRow): boolean {
  return (
    item.basePriceMinor !== null ||
    item.variants.some((variant) => variant.priceMinor !== null)
  );
}

function isAcceptableImportItem(item: ImportItemRow): boolean {
  return (
    item.decision === "pending" &&
    importItemHasPrice(item) &&
    (item.confidence ?? 0) >= 70 &&
    item.duplicateOfImportItemId === null
  );
}

function shouldStayPendingOnKeepOnly(item: ImportItemRow): boolean {
  return (
    item.needsReview ||
    (item.confidence ?? 0) < 70 ||
    !importItemHasPrice(item) ||
    item.duplicateOfImportItemId !== null
  );
}

async function writeVariantsAndModifiers(
  db: DbExecutor,
  itemId: string,
  variants: { name: string; priceMinor: number | null }[],
  modifiers: {
    name: string;
    additionalPriceMinor: number | null;
    isAvailable: boolean;
  }[],
  now: Date,
): Promise<void> {
  const pricedVariants = variants.filter(
    (variant): variant is { name: string; priceMinor: number } =>
      variant.priceMinor !== null && Boolean(variant.name.trim()),
  );
  await db
    .delete(menuItemVariants)
    .where(eq(menuItemVariants.menuItemId, itemId));
  if (pricedVariants.length > 0) {
    await db.insert(menuItemVariants).values(
      pricedVariants.map((variant, index) => ({
        menuItemId: itemId,
        name: variant.name,
        priceMinor: variant.priceMinor,
        sortOrder: index,
        createdAt: now,
      })),
    );
  }

  const namedModifiers = modifiers.filter((modifier) =>
    Boolean(modifier.name.trim()),
  );
  await db
    .delete(menuItemModifiers)
    .where(eq(menuItemModifiers.menuItemId, itemId));
  if (namedModifiers.length > 0) {
    await db.insert(menuItemModifiers).values(
      namedModifiers.map((modifier, index) => ({
        menuItemId: itemId,
        name: modifier.name,
        additionalPriceMinor: modifier.additionalPriceMinor ?? 0,
        isAvailable: modifier.isAvailable,
        sortOrder: index,
        createdAt: now,
      })),
    );
  }
}

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

export async function listMenuImports(
  db: DbClient,
  actorId: string,
  restaurantId: string,
) {
  const access = await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "viewManagement",
  );

  const rows = await db
    .select({
      menuImport: menuImports,
      menuTitle: menus.title,
      menuStatus: menus.status,
    })
    .from(menuImports)
    .leftJoin(menus, eq(menuImports.menuId, menus.id))
    .where(eq(menuImports.restaurantId, restaurantId))
    .orderBy(desc(menuImports.createdAt));

  return { access, imports: rows };
}

export async function getMenuImport(
  db: DbClient,
  actorId: string,
  importId: string,
) {
  const [row] = await db
    .select({ menuImport: menuImports, menu: menus })
    .from(menuImports)
    .innerJoin(menus, eq(menuImports.menuId, menus.id))
    .where(eq(menuImports.id, importId))
    .limit(1);
  if (!row) throw new NotFoundError("Import not found.");

  const menuAccess = await getMenuAccess(db, actorId, row.menu.id);
  if (
    menuAccess.access.actor.role !== "admin" &&
    !menuAccess.access.flags.canViewManagementData
  ) {
    throw new ForbiddenError();
  }

  const pages = await db
    .select()
    .from(menuImportPages)
    .where(eq(menuImportPages.importId, importId))
    .orderBy(asc(menuImportPages.pageNumber));

  const items = await db
    .select()
    .from(menuImportItems)
    .where(eq(menuImportItems.importId, importId))
    .orderBy(asc(menuImportItems.sortOrder), asc(menuImportItems.createdAt));

  return {
    import: row.menuImport,
    menu: row.menu,
    access: menuAccess.access,
    pages,
    items,
  };
}

async function buildChangeType(
  extracted: {
    name: string;
    description: string | null;
    basePriceMinor: number | null;
    variants: { name: string; priceMinor: number | null }[];
    availabilityStatus: "available" | "unavailable";
  },
  existing: MenuTreeItem | undefined,
): Promise<
  | "new"
  | "price_changed"
  | "description_changed"
  | "availability_changed"
  | "unchanged"
> {
  if (!existing) return "new";

  const priceChanged =
    existing.basePriceMinor !== extracted.basePriceMinor ||
    itemPriceKey(existing) !==
      JSON.stringify({
        base: extracted.basePriceMinor,
        variants: extracted.variants
          .filter((variant) => variant.priceMinor !== null)
          .map((variant) => [
            normalizeName(variant.name),
            variant.priceMinor,
          ]),
      });

  if (priceChanged) return "price_changed";
  if ((existing.description ?? null) !== extracted.description) {
    return "description_changed";
  }
  if (existing.availabilityStatus !== extracted.availabilityStatus) {
    return "availability_changed";
  }
  return "unchanged";
}

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
        const changeType = await buildChangeType(item, existing);
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

export async function updateImportItem(
  db: DbClient,
  actorId: string,
  importId: string,
  itemId: string,
  input: {
    decision: "pending" | "accept" | "reject";
    categoryName: string;
    name: string;
    description?: string;
    basePrice?: string;
    availabilityStatus: "available" | "unavailable";
  },
): Promise<void> {
  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);
  if (
    data.import.status !== "needs_review" &&
    data.import.status !== "reviewed"
  ) {
    throw new ConflictError("This import is not ready for review.");
  }

  const [staged] = await db
    .select()
    .from(menuImportItems)
    .where(
      and(
        eq(menuImportItems.id, itemId),
        eq(menuImportItems.importId, importId),
      ),
    )
    .limit(1);
  if (!staged) throw new NotFoundError("Import item not found.");

  const categoryName = input.categoryName.trim();
  const name = input.name.trim();
  if (!categoryName || !name) {
    throw new ValidationError("Category and item name are required.");
  }

  const price = parsePriceToMinor(input.basePrice ?? "");
  if (!price.ok) {
    throw new ValidationError(price.message, {
      basePrice: [price.message],
    });
  }

  await db
    .update(menuImportItems)
    .set({
      decision: input.decision,
      categoryName: categoryName.slice(0, 120),
      name: name.slice(0, 160),
      description: input.description?.trim() || null,
      basePriceMinor: price.minor,
      availabilityStatus: input.availabilityStatus,
      updatedAt: new Date(),
    })
    .where(eq(menuImportItems.id, itemId));

  await db
    .update(menuImports)
    .set({ updatedAt: new Date() })
    .where(eq(menuImports.id, importId));
}

export async function acceptAllImportItems(
  db: DbClient,
  actorId: string,
  importId: string,
): Promise<void> {
  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);
  if (
    data.import.status !== "needs_review" &&
    data.import.status !== "reviewed"
  ) {
    throw new ConflictError("This import is not ready for review.");
  }

  const acceptedIds = data.items
    .filter(isAcceptableImportItem)
    .map((item) => item.id);

  if (acceptedIds.length === 0) return;

  await db
    .update(menuImportItems)
    .set({ decision: "accept", updatedAt: new Date() })
    .where(
      and(
        eq(menuImportItems.importId, importId),
        eq(menuImportItems.decision, "pending"),
        inArray(menuImportItems.id, acceptedIds),
      ),
    );
}

export type ImportCategoryDecision = "accept" | "reject";

export type ImportCategoryDecisionResult = {
  categoryName: string;
  accepted: number;
  rejected: number;
  pending: number;
  pendingInCategory: number;
};

async function lockImportForReview(
  tx: DbExecutor,
  importId: string,
): Promise<void> {
  const [locked] = await tx
    .select({ id: menuImports.id, status: menuImports.status })
    .from(menuImports)
    .where(eq(menuImports.id, importId))
    .for("update")
    .limit(1);

  if (!locked) throw new NotFoundError("Import not found.");
  if (locked.status !== "needs_review" && locked.status !== "reviewed") {
    throw new ConflictError("This import is not ready for review.");
  }
}

async function updateItemDecisions(
  tx: DbExecutor,
  importId: string,
  itemIds: string[],
  decision: ImportCategoryDecision,
  now: Date,
): Promise<void> {
  if (itemIds.length === 0) return;

  await tx
    .update(menuImportItems)
    .set({ decision, updatedAt: now })
    .where(
      and(
        eq(menuImportItems.importId, importId),
        inArray(menuImportItems.id, itemIds),
      ),
    );
}

function countPendingAfter(
  items: ImportItemRow[],
  changed: Map<string, ImportCategoryDecision>,
  categoryKey?: string,
): number {
  return items.filter((item) => {
    if (
      categoryKey !== undefined &&
      normalizeName(item.categoryName) !== categoryKey
    ) {
      return false;
    }
    return (changed.get(item.id) ?? item.decision) === "pending";
  }).length;
}

export async function updateImportCategoryDecision(
  db: DbClient,
  actorId: string,
  importId: string,
  categoryName: string,
  decision: ImportCategoryDecision,
): Promise<ImportCategoryDecisionResult> {
  const categoryKey = normalizeName(categoryName);
  if (!categoryKey) {
    throw new ValidationError("Choose a category.");
  }

  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  const now = new Date();

  return db.transaction(async (tx) => {
    await lockImportForReview(tx, importId);

    const items = await tx
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, importId));
    const categoryItems = items.filter(
      (item) => normalizeName(item.categoryName) === categoryKey,
    );
    if (categoryItems.length === 0) {
      throw new ValidationError("That category was not found in this scan.");
    }

    const changedIds =
      decision === "accept"
        ? categoryItems
            .filter(isAcceptableImportItem)
            .map((item) => item.id)
        : categoryItems
            .filter((item) => item.decision === "pending")
            .map((item) => item.id);

    await updateItemDecisions(tx, importId, changedIds, decision, now);
    await tx
      .update(menuImports)
      .set({ updatedAt: now })
      .where(eq(menuImports.id, importId));

    const changed = new Map(
      changedIds.map((itemId) => [itemId, decision] as const),
    );

    return {
      categoryName: categoryItems[0]!.categoryName,
      accepted: decision === "accept" ? changedIds.length : 0,
      rejected: decision === "reject" ? changedIds.length : 0,
      pending: countPendingAfter(items, changed),
      pendingInCategory: countPendingAfter(items, changed, categoryKey),
    };
  });
}

export async function keepOnlyImportCategory(
  db: DbClient,
  actorId: string,
  importId: string,
  categoryName: string,
): Promise<ImportCategoryDecisionResult> {
  const categoryKey = normalizeName(categoryName);
  if (!categoryKey) {
    throw new ValidationError("Choose a category.");
  }

  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  const now = new Date();

  return db.transaction(async (tx) => {
    await lockImportForReview(tx, importId);

    const items = await tx
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, importId));
    const categoryItems = items.filter(
      (item) => normalizeName(item.categoryName) === categoryKey,
    );
    if (categoryItems.length === 0) {
      throw new ValidationError("That category was not found in this scan.");
    }

    const acceptedIds = categoryItems
      .filter(isAcceptableImportItem)
      .map((item) => item.id);
    const rejectedIds = items
      .filter((item) => normalizeName(item.categoryName) !== categoryKey)
      .filter(
        (item) =>
          item.decision === "accept" ||
          (item.decision === "pending" && !shouldStayPendingOnKeepOnly(item)),
      )
      .map((item) => item.id);

    await updateItemDecisions(tx, importId, acceptedIds, "accept", now);
    await updateItemDecisions(tx, importId, rejectedIds, "reject", now);
    await tx
      .update(menuImports)
      .set({ updatedAt: now })
      .where(eq(menuImports.id, importId));

    const changed = new Map<string, ImportCategoryDecision>([
      ...acceptedIds.map((itemId) => [itemId, "accept"] as const),
      ...rejectedIds.map((itemId) => [itemId, "reject"] as const),
    ]);

    return {
      categoryName: categoryItems[0]!.categoryName,
      accepted: acceptedIds.length,
      rejected: rejectedIds.length,
      pending: countPendingAfter(items, changed),
      pendingInCategory: countPendingAfter(items, changed, categoryKey),
    };
  });
}

export async function applyMenuImport(
  db: DbClient,
  actorId: string,
  importId: string,
): Promise<string> {
  const data = await getMenuImport(db, actorId, importId);
  const { access, menu } = await requireDraftEditable(
    db,
    actorId,
    data.menu.id,
  );
  if (
    data.import.status !== "needs_review" &&
    data.import.status !== "reviewed"
  ) {
    throw new ConflictError("This import is not ready to apply.");
  }

  const accepted = data.items.filter((item) => item.decision === "accept");
  if (accepted.length === 0) {
    throw new ValidationError(
      "Accept at least one reviewed item before applying this import.",
    );
  }

  for (const item of accepted) {
    const pricedVariant = item.variants.some(
      (variant) => variant.priceMinor !== null,
    );
    if (item.basePriceMinor === null && !pricedVariant) {
      throw new ValidationError(
        `“${item.name}” has no price. Edit it before applying.`,
      );
    }
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: menuImports.status })
      .from(menuImports)
      .where(eq(menuImports.id, importId))
      .for("update")
      .limit(1);
    if (!locked) throw new NotFoundError("Import not found.");
    if (locked.status !== "needs_review" && locked.status !== "reviewed") {
      throw new ConflictError("This import is not ready to apply.");
    }

    await lockDraftMenu(tx, menu.id);
    const tree = await loadMenuTree(tx, menu.id);
    if (!tree) throw new NotFoundError("Target menu not found.");

    const categoriesByName = new Map<string, MenuTreeCategory>();
    for (const category of tree.categories) {
      categoriesByName.set(normalizeName(category.name), category);
    }
    let nextCategorySort =
      Math.max(0, ...tree.categories.map((category) => category.sortOrder)) + 10;

    const existingByLogicalId = new Map<string, MenuTreeItem>();
    const nextItemSortByCategory = new Map<string, number>();
    for (const category of tree.categories) {
      nextItemSortByCategory.set(
        category.id,
        Math.max(0, ...category.items.map((item) => item.sortOrder)) + 10,
      );
      for (const item of category.items) {
        existingByLogicalId.set(item.logicalId, item);
      }
    }

    let created = 0;
    let updated = 0;

    for (const staged of accepted) {
      let category = categoriesByName.get(normalizeName(staged.categoryName));
      if (!category) {
        const [insertedCategory] = await tx
          .insert(menuCategories)
          .values({
            menuId: menu.id,
            name: staged.categoryName,
            sortOrder: nextCategorySort,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!insertedCategory) {
          throw new ConflictError("Could not create an imported category.");
        }
        nextCategorySort += 10;
        category = { ...insertedCategory, items: [] };
        categoriesByName.set(normalizeName(category.name), category);
      }

      const existing = staged.matchedLogicalId
        ? existingByLogicalId.get(staged.matchedLogicalId)
        : undefined;

      if (existing) {
        await tx
          .update(menuItems)
          .set({
            categoryId: category.id,
            name: staged.name,
            description: staged.description,
            basePriceMinor: staged.basePriceMinor,
            currency: access.restaurant.currency,
            availabilityStatus: staged.availabilityStatus,
            updatedAt: now,
          })
          .where(eq(menuItems.id, existing.id));
        await writeVariantsAndModifiers(
          tx,
          existing.id,
          staged.variants,
          staged.modifiers,
          now,
        );
        updated += 1;
      } else {
        const sortOrder = nextItemSortByCategory.get(category.id) ?? 10;
        const [inserted] = await tx
          .insert(menuItems)
          .values({
            categoryId: category.id,
            name: staged.name,
            description: staged.description,
            basePriceMinor: staged.basePriceMinor,
            currency: access.restaurant.currency,
            availabilityStatus: staged.availabilityStatus,
            sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!inserted) {
          throw new ConflictError("Could not create an imported item.");
        }
        nextItemSortByCategory.set(category.id, sortOrder + 10);
        await writeVariantsAndModifiers(
          tx,
          inserted.id,
          staged.variants,
          staged.modifiers,
          now,
        );
        created += 1;
      }
    }

    await tx
      .update(menus)
      .set({ lastUpdatedAt: now, updatedAt: now })
      .where(eq(menus.id, menu.id));

    await tx
      .update(menuImports)
      .set({
        status: "applied",
        appliedAt: now,
        reviewedAt: now,
        reviewedBy: access.actor.id,
        updatedAt: now,
      })
      .where(eq(menuImports.id, importId));

    await writeAuditLog(tx, {
      actor: { id: access.actor.id, email: access.actor.email },
      action: "import_applied",
      entityType: "menu",
      entityId: menu.id,
      details: {
        restaurantId: access.restaurant.id,
        importId,
        created,
        updated,
      },
    });
  });

  return menu.id;
}
