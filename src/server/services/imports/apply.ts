import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  menuCategories,
  menuImportItems,
  menuImports,
  menuItems,
  menus,
} from "@/db/schema";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { writeAuditLog } from "../audit";
import { normalizeName } from "../import-rules";
import { lockDraftMenu, requireDraftEditable } from "../menu-access";
import { replaceItemVariantsAndModifiers } from "../menu-item-details";
import {
  loadMenuTree,
  type MenuTreeCategory,
  type MenuTreeItem,
} from "../menu-tree";
import { lockImportForReview } from "./lock";
import { getMenuImport } from "./queries";

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
  const now = new Date();

  await db.transaction(async (tx) => {
    await lockImportForReview(
      tx,
      importId,
      "This import is not ready to apply.",
    );

    const accepted = await tx
      .select()
      .from(menuImportItems)
      .where(
        and(
          eq(menuImportItems.importId, importId),
          eq(menuImportItems.decision, "accept"),
        ),
      )
      .orderBy(asc(menuImportItems.sortOrder), asc(menuImportItems.createdAt));

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
        await replaceItemVariantsAndModifiers(
          tx,
          existing.id,
          { variants: staged.variants, modifiers: staged.modifiers },
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
        await replaceItemVariantsAndModifiers(
          tx,
          inserted.id,
          { variants: staged.variants, modifiers: staged.modifiers },
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
