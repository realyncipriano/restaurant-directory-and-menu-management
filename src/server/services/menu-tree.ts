import { asc, inArray } from "drizzle-orm";

import {
  menuCategories,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";

export type MenuRecord = typeof menus.$inferSelect;
export type MenuCategoryRecord = typeof menuCategories.$inferSelect;
export type MenuItemRecord = typeof menuItems.$inferSelect;
export type VariantRecord = typeof menuItemVariants.$inferSelect;
export type ModifierRecord = typeof menuItemModifiers.$inferSelect;

export type MenuTreeItem = MenuItemRecord & {
  variants: VariantRecord[];
  modifiers: ModifierRecord[];
};

export type MenuTreeCategory = MenuCategoryRecord & {
  items: MenuTreeItem[];
};

export type MenuTree = {
  menu: MenuRecord;
  categories: MenuTreeCategory[];
};

export type MenuTreeMap = Map<string, MenuTree>;

export async function loadMenuTrees(
  db: DbExecutor,
  menuIds: string[],
): Promise<MenuTreeMap> {
  if (menuIds.length === 0) return new Map();

  const menuRecords = await db
    .select()
    .from(menus)
    .where(inArray(menus.id, menuIds));

  return loadMenuTreesForRecords(db, menuRecords);
}

export async function loadMenuTreesForRecords(
  db: DbExecutor,
  menuRecords: MenuRecord[],
): Promise<MenuTreeMap> {
  const trees: MenuTreeMap = new Map();
  if (menuRecords.length === 0) return trees;

  for (const menu of menuRecords) {
    trees.set(menu.id, { menu, categories: [] });
  }

  const menuIds = menuRecords.map((menu) => menu.id);
  const categories = await db
    .select()
    .from(menuCategories)
    .where(inArray(menuCategories.menuId, menuIds))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));

  const categoryIds = categories.map((category) => category.id);
  const items = categoryIds.length
    ? await db
        .select()
        .from(menuItems)
        .where(inArray(menuItems.categoryId, categoryIds))
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.name))
    : [];

  const itemIds = items.map((item) => item.id);
  const variants = itemIds.length
    ? await db
        .select()
        .from(menuItemVariants)
        .where(inArray(menuItemVariants.menuItemId, itemIds))
        .orderBy(
          asc(menuItemVariants.sortOrder),
          asc(menuItemVariants.name),
        )
    : [];
  const modifiers = itemIds.length
    ? await db
        .select()
        .from(menuItemModifiers)
        .where(inArray(menuItemModifiers.menuItemId, itemIds))
        .orderBy(
          asc(menuItemModifiers.sortOrder),
          asc(menuItemModifiers.name),
        )
    : [];

  const variantsByItem = new Map<string, VariantRecord[]>();
  for (const variant of variants) {
    const list = variantsByItem.get(variant.menuItemId) ?? [];
    list.push(variant);
    variantsByItem.set(variant.menuItemId, list);
  }

  const modifiersByItem = new Map<string, ModifierRecord[]>();
  for (const modifier of modifiers) {
    const list = modifiersByItem.get(modifier.menuItemId) ?? [];
    list.push(modifier);
    modifiersByItem.set(modifier.menuItemId, list);
  }

  const itemsByCategory = new Map<string, MenuTreeItem[]>();
  for (const item of items) {
    const list = itemsByCategory.get(item.categoryId) ?? [];
    list.push({
      ...item,
      variants: variantsByItem.get(item.id) ?? [],
      modifiers: modifiersByItem.get(item.id) ?? [],
    });
    itemsByCategory.set(item.categoryId, list);
  }

  for (const category of categories) {
    trees.get(category.menuId)?.categories.push({
      ...category,
      items: itemsByCategory.get(category.id) ?? [],
    });
  }

  return trees;
}

export async function loadMenuTree(
  db: DbExecutor,
  menuId: string,
): Promise<MenuTree | null> {
  const tree = (await loadMenuTrees(db, [menuId])).get(menuId);
  return tree ?? null;
}
