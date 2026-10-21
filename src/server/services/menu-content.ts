import { and, count, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { isUniqueViolation } from "@/db/pool-errors";
import {
  menuCategories,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import {
  ConflictError,
  NotFoundError,
} from "@/lib/errors";
import {
  categoryInputSchema,
  type ItemInput,
} from "@/lib/validation/menu";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "./audit";
import { lockDraftMenu, requireDraftEditable } from "./menu-access";
import type {
  MenuCategoryRecord,
  MenuItemRecord,
} from "./menu-tree";

type Actor = { id: string; email: string };

async function touchMenu(
  db: DbExecutor,
  menuId: string,
  now: Date,
): Promise<void> {
  await db
    .update(menus)
    .set({ lastUpdatedAt: now, updatedAt: now })
    .where(eq(menus.id, menuId));
}

async function requireCategory(
  db: DbExecutor,
  menuId: string,
  categoryId: string,
): Promise<MenuCategoryRecord> {
  const [category] = await db
    .select()
    .from(menuCategories)
    .where(
      and(
        eq(menuCategories.id, categoryId),
        eq(menuCategories.menuId, menuId),
      ),
    )
    .limit(1);

  if (!category) {
    throw new NotFoundError("Category not found.");
  }
  return category;
}

async function requireItem(
  db: DbExecutor,
  menuId: string,
  itemId: string,
): Promise<{ item: MenuItemRecord; category: MenuCategoryRecord }> {
  const [row] = await db
    .select({ item: menuItems, category: menuCategories })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(
      and(eq(menuItems.id, itemId), eq(menuCategories.menuId, menuId)),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundError("Menu item not found.");
  }
  return row;
}

async function writeItemDetails(
  db: DbExecutor,
  itemId: string,
  item: ItemInput,
  now: Date,
): Promise<void> {
  await db.delete(menuItemVariants).where(eq(menuItemVariants.menuItemId, itemId));
  await db
    .delete(menuItemModifiers)
    .where(eq(menuItemModifiers.menuItemId, itemId));

  if (item.variants.length > 0) {
    await db.insert(menuItemVariants).values(
      item.variants.map((variant, index) => ({
        menuItemId: itemId,
        name: variant.name,
        priceMinor: variant.price,
        sortOrder: index,
        createdAt: now,
      })),
    );
  }

  if (item.modifiers.length > 0) {
    await db.insert(menuItemModifiers).values(
      item.modifiers.map((modifier, index) => ({
        menuItemId: itemId,
        name: modifier.name,
        additionalPriceMinor: modifier.price,
        isAvailable: modifier.isAvailable,
        sortOrder: index,
        createdAt: now,
      })),
    );
  }
}

export async function createCategory(
  db: DbClient,
  actorId: string,
  menuId: string,
  input: {
    name: string;
    description?: string;
    sortOrder?: number | string;
  },
): Promise<MenuCategoryRecord> {
  const { access } = await requireDraftEditable(db, actorId, menuId);
  const parsed = parseOrThrow(categoryInputSchema, input);
  const now = new Date();
  const actor: Actor = { id: access.actor.id, email: access.actor.email };

  try {
    return await db.transaction(async (tx) => {
      await lockDraftMenu(tx, menuId);
      const [category] = await tx
        .insert(menuCategories)
        .values({
          menuId,
          name: parsed.name,
          description: parsed.description,
          sortOrder: parsed.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!category) throw new ConflictError("Could not add the category.");

      await touchMenu(tx, menuId, now);
      await writeAuditLog(tx, {
        actor,
        action: "category_created",
        entityType: "menu_category",
        entityId: category.id,
        details: { menuId, name: category.name },
      });

      return category;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        "A category with that name already exists on this menu.",
      );
    }
    throw error;
  }
}

export async function updateCategory(
  db: DbClient,
  actorId: string,
  menuId: string,
  categoryId: string,
  input: {
    name: string;
    description?: string;
    sortOrder?: number | string;
  },
): Promise<MenuCategoryRecord> {
  const { access } = await requireDraftEditable(db, actorId, menuId);
  const parsed = parseOrThrow(categoryInputSchema, input);
  const now = new Date();
  const actor: Actor = { id: access.actor.id, email: access.actor.email };

  try {
    return await db.transaction(async (tx) => {
      await lockDraftMenu(tx, menuId);
      await requireCategory(tx, menuId, categoryId);

      const [updated] = await tx
        .update(menuCategories)
        .set({
          name: parsed.name,
          description: parsed.description,
          sortOrder: parsed.sortOrder,
          updatedAt: now,
        })
        .where(eq(menuCategories.id, categoryId))
        .returning();

      if (!updated) throw new NotFoundError("Category not found.");

      await touchMenu(tx, menuId, now);
      await writeAuditLog(tx, {
        actor,
        action: "category_updated",
        entityType: "menu_category",
        entityId: categoryId,
        details: { menuId, name: updated.name },
      });

      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        "A category with that name already exists on this menu.",
      );
    }
    throw error;
  }
}

export async function deleteCategory(
  db: DbClient,
  actorId: string,
  menuId: string,
  categoryId: string,
): Promise<void> {
  const { access } = await requireDraftEditable(db, actorId, menuId);
  const now = new Date();
  const actor: Actor = { id: access.actor.id, email: access.actor.email };

  await db.transaction(async (tx) => {
    await lockDraftMenu(tx, menuId);
    const category = await requireCategory(tx, menuId, categoryId);
    const [row] = await tx
      .select({ total: count() })
      .from(menuItems)
      .where(eq(menuItems.categoryId, categoryId));

    await tx.delete(menuCategories).where(eq(menuCategories.id, categoryId));
    await touchMenu(tx, menuId, now);
    await writeAuditLog(tx, {
      actor,
      action: "category_deleted",
      entityType: "menu_category",
      entityId: categoryId,
      details: {
        menuId,
        name: category.name,
        deletedItemCount: row?.total ?? 0,
      },
    });
  });
}

export async function createMenuItem(
  db: DbClient,
  actorId: string,
  menuId: string,
  input: ItemInput,
): Promise<MenuItemRecord> {
  const { access } = await requireDraftEditable(db, actorId, menuId);
  const parsed = input;
  const now = new Date();
  const actor: Actor = { id: access.actor.id, email: access.actor.email };

  return db.transaction(async (tx) => {
    await lockDraftMenu(tx, menuId);
    await requireCategory(tx, menuId, parsed.categoryId);

    const [item] = await tx
      .insert(menuItems)
      .values({
        categoryId: parsed.categoryId,
        name: parsed.name,
        description: parsed.description,
        basePriceMinor: parsed.basePrice,
        currency: access.restaurant.currency,
        availabilityStatus: parsed.availabilityStatus,
        sortOrder: parsed.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!item) throw new ConflictError("Could not add the menu item.");

    await writeItemDetails(tx, item.id, parsed, now);
    await touchMenu(tx, menuId, now);
    await writeAuditLog(tx, {
      actor,
      action: "item_created",
      entityType: "menu_item",
      entityId: item.id,
      details: {
        menuId,
        name: item.name,
        basePriceMinor: item.basePriceMinor,
      },
    });

    return item;
  });
}

export async function updateMenuItem(
  db: DbClient,
  actorId: string,
  menuId: string,
  itemId: string,
  input: ItemInput,
): Promise<MenuItemRecord> {
  const { access } = await requireDraftEditable(db, actorId, menuId);
  const parsed = input;
  const now = new Date();
  const actor: Actor = { id: access.actor.id, email: access.actor.email };

  return db.transaction(async (tx) => {
    await lockDraftMenu(tx, menuId);
    const existing = await requireItem(tx, menuId, itemId);
    await requireCategory(tx, menuId, parsed.categoryId);

    const [updated] = await tx
      .update(menuItems)
      .set({
        categoryId: parsed.categoryId,
        name: parsed.name,
        description: parsed.description,
        basePriceMinor: parsed.basePrice,
        availabilityStatus: parsed.availabilityStatus,
        sortOrder: parsed.sortOrder,
        updatedAt: now,
      })
      .where(eq(menuItems.id, itemId))
      .returning();

    if (!updated) throw new NotFoundError("Menu item not found.");

    await writeItemDetails(tx, itemId, parsed, now);
    await touchMenu(tx, menuId, now);
    await writeAuditLog(tx, {
      actor,
      action: "item_updated",
      entityType: "menu_item",
      entityId: itemId,
      details: {
        menuId,
        name: updated.name,
        previousBasePriceMinor: existing.item.basePriceMinor,
        basePriceMinor: updated.basePriceMinor,
        availabilityStatus: updated.availabilityStatus,
      },
    });

    if (existing.item.basePriceMinor !== updated.basePriceMinor) {
      await writeAuditLog(tx, {
        actor,
        action: "price_changed",
        entityType: "menu_item",
        entityId: itemId,
        details: {
          menuId,
          name: updated.name,
          previousBasePriceMinor: existing.item.basePriceMinor,
          basePriceMinor: updated.basePriceMinor,
        },
      });
    }

    return updated;
  });
}

export async function deleteMenuItem(
  db: DbClient,
  actorId: string,
  menuId: string,
  itemId: string,
): Promise<void> {
  const { access } = await requireDraftEditable(db, actorId, menuId);
  const now = new Date();
  const actor: Actor = { id: access.actor.id, email: access.actor.email };

  await db.transaction(async (tx) => {
    await lockDraftMenu(tx, menuId);
    const existing = await requireItem(tx, menuId, itemId);
    await tx.delete(menuItems).where(eq(menuItems.id, itemId));
    await touchMenu(tx, menuId, now);
    await writeAuditLog(tx, {
      actor,
      action: "item_deleted",
      entityType: "menu_item",
      entityId: itemId,
      details: { menuId, name: existing.item.name },
    });
  });
}
