import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  menuCategories,
  menuChangeLogs,
  menuItems,
  menus,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { NotFoundError } from "@/lib/errors";
import { requireMenuPermission } from "../menu-access";
import { loadMenuTree, type MenuRecord } from "../menu-tree";
import { requireRestaurantPermission } from "../restaurant-access";

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

export type MenuLineageDeletion = {
  auditLogId: string;
  entityId: string | null;
  createdAt: Date;
};

/**
 * Deletion is an explicit audit event, not merely the absence of a draft or
 * published version. A discarded draft-only lineage is fully archived too, so
 * the `menu_deleted` event (keyed by lineageId) is the source of truth.
 */
export async function findMenuLineageDeletion(
  db: DbExecutor,
  lineageId: string,
): Promise<MenuLineageDeletion | null> {
  const [row] = await db
    .select({
      auditLogId: auditLogs.id,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, "menu"),
        eq(auditLogs.action, "menu_deleted"),
        sql`${auditLogs.details}->>'lineageId' = ${lineageId}`,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  return row ?? null;
}

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

  const deletion = await findMenuLineageDeletion(db, menu.lineageId);

  return {
    menu,
    access,
    tree,
    versions,
    changes,
    deletion,
    isDeleted: deletion !== null,
  };
}
