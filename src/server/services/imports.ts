import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
  deleteObject,
  isStorageConfigured,
  putObject,
  readObject,
} from "./storage";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
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

export async function createMenuImport(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  menuId: string,
  files: FormDataEntryValue[],
): Promise<string> {
  const { access, menu } = await requireDraftEditable(db, actorId, menuId);
  if (access.restaurant.id !== restaurantId) {
    throw new NotFoundError("Menu not found.");
  }
  if (!isStorageConfigured()) {
    throw new ConflictError(
      "Private scan storage is not configured. Set the R2 credentials first.",
    );
  }

  const config = getExtractionConfig();
  const maxPages = config?.maxPages ?? 10;
  if (files.length === 0) {
    throw new ValidationError("Choose at least one menu image to scan.");
  }
  if (files.length > maxPages) {
    throw new ValidationError(`Upload at most ${maxPages} page images at once.`);
  }

  const importId = randomUUID();
  const uploadedKeys: string[] = [];
  const prepared: {
    key: string;
    mimeType: string;
    sizeBytes: number;
  }[] = [];

  try {
    for (const [index, file] of files.entries()) {
      if (!(file instanceof File)) {
        throw new ValidationError("One of the selected files could not be read.");
      }
      if (file.size === 0) {
        throw new ValidationError("One of the selected files is empty.");
      }
      if (file.size > MAX_SOURCE_BYTES) {
        throw new ValidationError("Each scan page must be 8 MB or smaller.");
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const detected = await fileTypeFromBuffer(buffer);
      const extension = detected
        ? ALLOWED_SOURCE_MIME.get(detected.mime)
        : undefined;
      if (!detected || !extension) {
        throw new ValidationError(
          "Scan pages must be JPEG, PNG, or WebP images.",
        );
      }

      const key = buildObjectKey(
        `imports/${importId}/page-${index + 1}`,
        extension,
      );
      await putObject(
        key,
        buffer,
        detected.mime,
        "private, no-store",
      );
      uploadedKeys.push(key);
      prepared.push({
        key,
        mimeType: detected.mime,
        sizeBytes: buffer.length,
      });
    }

    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(menuImports).values({
        id: importId,
        restaurantId,
        menuId: menu.id,
        uploadedBy: access.actor.id,
        status: "uploaded",
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(menuImportPages).values(
        prepared.map((page, index) => ({
          importId,
          pageNumber: index + 1,
          privateSourceObjectKey: page.key,
          mimeType: page.mimeType,
          sizeBytes: page.sizeBytes,
          processingStatus: "uploaded" as const,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });

    return importId;
  } catch (error) {
    await Promise.all(uploadedKeys.map((key) => deleteObject(key)));
    throw error;
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
    row.menuImport.status !== "failed"
  ) {
    throw new ConflictError(
      "This import cannot be processed again. Upload a new scan to re-extract.",
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
  const claimed = await db
    .update(menuImports)
    .set({ status: "processing", errorDetails: null, updatedAt: now })
    .where(
      and(
        eq(menuImports.id, importId),
        inArray(menuImports.status, ["uploaded", "failed"]),
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
      const buffer = await readObject(page.privateSourceObjectKey);
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

      await tx
        .update(menuImports)
        .set({
          status: "needs_review",
          extractionProvider: `${config.provider}:${config.model}`,
          updatedAt: processedAt,
        })
        .where(eq(menuImports.id, importId));
    });
  } catch (error) {
    const message =
      error instanceof ValidationError
        ? error.message
        : "Menu extraction failed. Check the provider configuration and try again.";
    console.error("[imports] Menu import failed.", importId, error);

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
        updatedAt: new Date(),
      })
      .where(eq(menuImports.id, importId));
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
    .filter((item) => {
      const priced =
        item.basePriceMinor !== null ||
        item.variants.some((variant) => variant.priceMinor !== null);
      return (
        item.decision === "pending" &&
        priced &&
        (item.confidence ?? 0) >= 70 &&
        item.duplicateOfImportItemId === null
      );
    })
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
