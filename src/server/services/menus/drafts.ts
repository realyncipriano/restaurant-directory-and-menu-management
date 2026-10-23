import { and, eq, max } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { isUniqueViolation } from "@/db/pool-errors";
import {
  menuCategories,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
} from "@/db/schema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "../audit";
import { lockMenuRow, requireMenuPermission } from "../menu-access";
import { loadMenuTree, type MenuRecord } from "../menu-tree";

export async function startEditingMenu(
  db: DbClient,
  actorId: string,
  menuId: string,
): Promise<MenuRecord> {
  const { menu, access } = await requireMenuPermission(
    db,
    actorId,
    menuId,
    "editMenu",
  );

  if (access.restaurant.status !== "active") {
    throw new ConflictError(
      "Archived restaurants cannot be edited. Reactivate it first.",
    );
  }

  if (menu.status === "draft") return menu;

  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const lockedSource = await lockMenuRow(tx, menu.id);

      const [existingDraft] = await tx
        .select()
        .from(menus)
        .where(
          and(
            eq(menus.restaurantId, lockedSource.restaurantId),
            eq(menus.lineageId, lockedSource.lineageId),
            eq(menus.status, "draft"),
          ),
        )
        .limit(1);

      if (existingDraft) return existingDraft;
      if (lockedSource.status === "draft") return lockedSource;

      let source = lockedSource;
      if (lockedSource.status === "archived") {
        const [published] = await tx
          .select()
          .from(menus)
          .where(
            and(
              eq(menus.restaurantId, lockedSource.restaurantId),
              eq(menus.lineageId, lockedSource.lineageId),
              eq(menus.status, "published"),
            ),
          )
          .limit(1);

        if (!published) {
          throw new ConflictError(
            "This archived menu has no published version to edit.",
          );
        }
        source = published;
      }

      const [versionRow] = await tx
        .select({ version: max(menus.version) })
        .from(menus)
        .where(
          and(
            eq(menus.restaurantId, lockedSource.restaurantId),
            eq(menus.lineageId, lockedSource.lineageId),
          ),
        );
      const nextVersion = Number(versionRow?.version ?? 0) + 1;

      const [draft] = await tx
        .insert(menus)
        .values({
          restaurantId: source.restaurantId,
          title: source.title,
          slug: source.slug,
          description: source.description,
          status: "draft",
          lineageId: source.lineageId,
          version: nextVersion,
          clonedFromMenuId: source.id,
          lastUpdatedAt: now,
          createdBy: access.actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!draft) throw new ConflictError("Could not create a draft.");

      const sourceTree = await loadMenuTree(tx, source.id);
      if (!sourceTree) throw new NotFoundError("Source menu not found.");

      for (const category of sourceTree.categories) {
        const [newCategory] = await tx
          .insert(menuCategories)
          .values({
            menuId: draft.id,
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!newCategory) continue;

        for (const item of category.items) {
          const [newItem] = await tx
            .insert(menuItems)
            .values({
              categoryId: newCategory.id,
              logicalId: item.logicalId,
              name: item.name,
              description: item.description,
              basePriceMinor: item.basePriceMinor,
              currency: item.currency,
              imageObjectKey: item.imageObjectKey,
              availabilityStatus: item.availabilityStatus,
              sortOrder: item.sortOrder,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          if (!newItem) continue;

          if (item.variants.length > 0) {
            await tx.insert(menuItemVariants).values(
              item.variants.map((variant) => ({
                menuItemId: newItem.id,
                name: variant.name,
                priceMinor: variant.priceMinor,
                sortOrder: variant.sortOrder,
                createdAt: now,
              })),
            );
          }

          if (item.modifiers.length > 0) {
            await tx.insert(menuItemModifiers).values(
              item.modifiers.map((modifier) => ({
                menuItemId: newItem.id,
                name: modifier.name,
                additionalPriceMinor: modifier.additionalPriceMinor,
                isAvailable: modifier.isAvailable,
                sortOrder: modifier.sortOrder,
                createdAt: now,
              })),
            );
          }
        }
      }

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action: "menu_duplicated",
        entityType: "menu",
        entityId: draft.id,
        details: {
          restaurantId: draft.restaurantId,
          lineageId: draft.lineageId,
          fromMenuId: source.id,
          fromVersion: source.version,
          toVersion: draft.version,
        },
      });

      return draft;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [draft] = await db
        .select()
        .from(menus)
        .where(
          and(
            eq(menus.restaurantId, menu.restaurantId),
            eq(menus.lineageId, menu.lineageId),
            eq(menus.status, "draft"),
          ),
        )
        .limit(1);
      if (draft) return draft;
    }
    throw error;
  }
}
