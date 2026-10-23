import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  ne,
} from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  menuCategories,
  menuChangeLogs,
  menuItems,
  menus,
} from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { requireMenuPermission } from "../menu-access";
import { loadMenuTree, type MenuRecord } from "../menu-tree";
import {
  getRestaurantAccess,
  requireRestaurantPermission,
} from "../restaurant-access";

export type MenuLineageSummary = {
  lineageId: string;
  title: string;
  published: MenuRecord | null;
  draft: MenuRecord | null;
  latestVersion: number;
  publishedItemCount: number;
  draftItemCount: number;
  updatedAt: Date;
};

export async function listMenusForRestaurant(
  db: DbClient,
  actorId: string,
  restaurantId: string,
): Promise<MenuLineageSummary[]> {
  await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "viewManagement",
  );

  const rows = await db
    .select()
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, restaurantId),
        ne(menus.status, "archived"),
      ),
    )
    .orderBy(desc(menus.version), asc(menus.title));

  if (rows.length === 0) return [];

  const menuIds = rows.map((menu) => menu.id);
  const countRows = await db
    .select({
      menuId: menuCategories.menuId,
      total: count(menuItems.id),
    })
    .from(menuCategories)
    .leftJoin(menuItems, eq(menuItems.categoryId, menuCategories.id))
    .where(inArray(menuCategories.menuId, menuIds))
    .groupBy(menuCategories.menuId);

  const counts = new Map(
    countRows.map((row) => [row.menuId, row.total] as const),
  );

  const byLineage = new Map<string, MenuRecord[]>();
  for (const menu of rows) {
    const list = byLineage.get(menu.lineageId) ?? [];
    list.push(menu);
    byLineage.set(menu.lineageId, list);
  }

  const summaries: MenuLineageSummary[] = [];
  for (const [lineageId, versions] of byLineage) {
    const published =
      versions.find((menu) => menu.status === "published") ?? null;
    const draft = versions.find((menu) => menu.status === "draft") ?? null;
    if (!published && !draft) continue;

    const latest =
      [...versions].sort((left, right) => right.version - left.version)[0] ??
      versions[0]!;
    const primary = draft ?? published ?? latest;

    summaries.push({
      lineageId,
      title: primary.title,
      published,
      draft,
      latestVersion: latest.version,
      publishedItemCount: published ? (counts.get(published.id) ?? 0) : 0,
      draftItemCount: draft ? (counts.get(draft.id) ?? 0) : 0,
      updatedAt: primary.updatedAt,
    });
  }

  return summaries.sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}

export async function getMenuManagement(
  db: DbClient,
  actorId: string,
  menuId: string,
) {
  const { menu, access } = await requireMenuPermission(
    db,
    actorId,
    menuId,
    "viewManagement",
  );

  const tree = await loadMenuTree(db, menuId);
  if (!tree) throw new NotFoundError("Menu not found.");

  const versions = await db
    .select()
    .from(menus)
    .where(eq(menus.lineageId, menu.lineageId))
    .orderBy(desc(menus.version));

  const changes = await db
    .select()
    .from(menuChangeLogs)
    .where(eq(menuChangeLogs.menuId, menuId))
    .orderBy(desc(menuChangeLogs.createdAt))
    .limit(50);

  return { menu, access, tree, versions, changes };
}

export async function getMenuContextForRestaurant(
  db: DbClient,
  actorId: string,
  restaurantId: string,
) {
  const access = await getRestaurantAccess(db, actorId, restaurantId);
  return access;
}
