import "server-only";

import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  menuImportItems,
  menuImportPages,
  menuImports,
  menus,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { getAppSettings } from "./app-settings";
import { requireAdminActor } from "./auth";
import { purgeExpiredMenuImports } from "./imports/purge";

export type DeletedMenuSummary = {
  lineageId: string;
  menuId: string;
  title: string;
  slug: string;
  version: number;
  versionCount: number;
  hadPublished: boolean;
  deletedAt: Date;
  deletedByEmail: string | null;
};

export const DELETED_SCANS_PAGE_SIZE = 15;

export type DeletedScanSummary = {
  id: string;
  menuId: string | null;
  menuTitle: string | null;
  menuStatus: string | null;
  status: string;
  pageCount: number;
  itemCount: number;
  createdAt: Date;
  deletedAt: Date;
  deletedByEmail: string | null;
};

async function listDeletedMenus(
  db: DbClient,
  restaurantId: string,
): Promise<DeletedMenuSummary[]> {
  const rows = await db
    .select({
      menuId: menus.id,
      lineageId: menus.lineageId,
      title: menus.title,
      slug: menus.slug,
      version: menus.version,
      deletedAt: auditLogs.createdAt,
      deletedByEmail: auditLogs.actorEmail,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .innerJoin(menus, sql`${menus.id}::text = ${auditLogs.entityId}`)
    .where(
      and(
        eq(auditLogs.entityType, "menu"),
        eq(auditLogs.action, "menu_deleted"),
        eq(menus.restaurantId, restaurantId),
      ),
    )
    .orderBy(desc(auditLogs.createdAt));

  const latestByLineage = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByLineage.has(row.lineageId)) {
      latestByLineage.set(row.lineageId, row);
    }
  }

  if (latestByLineage.size === 0) return [];

  const versionCounts = await db
    .select({ lineageId: menus.lineageId, total: count() })
    .from(menus)
    .where(inArray(menus.lineageId, [...latestByLineage.keys()]))
    .groupBy(menus.lineageId);
  const countsByLineage = new Map(
    versionCounts.map((row) => [row.lineageId, row.total] as const),
  );

  return [...latestByLineage.values()].map((row) => ({
    lineageId: row.lineageId,
    menuId: row.menuId,
    title: row.title,
    slug: row.slug,
    version: row.version,
    versionCount: countsByLineage.get(row.lineageId) ?? 1,
    hadPublished: row.details?.hadPublished === true,
    deletedAt: row.deletedAt,
    deletedByEmail: row.deletedByEmail,
  }));
}

async function listDeletedScans(
  db: DbClient,
  restaurantId: string,
  options: { page?: number } = {},
): Promise<{
  scans: DeletedScanSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}> {
  const pageSize = DELETED_SCANS_PAGE_SIZE;
  const where = and(
    eq(menuImports.restaurantId, restaurantId),
    isNotNull(menuImports.deletedAt),
  );

  const [totalRow] = await db
    .select({ total: count() })
    .from(menuImports)
    .where(where);
  const total = totalRow?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    Math.max(1, Math.floor(options.page ?? 1)),
    pageCount,
  );

  if (total === 0) {
    return { scans: [], total, page, pageCount, pageSize };
  }

  const rows = await db
    .select({
      menuImport: menuImports,
      menuTitle: menus.title,
      menuStatus: menus.status,
      deletedByEmail: users.email,
    })
    .from(menuImports)
    .leftJoin(menus, eq(menuImports.menuId, menus.id))
    .leftJoin(users, eq(menuImports.deletedBy, users.id))
    .where(where)
    .orderBy(desc(menuImports.deletedAt), desc(menuImports.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const importIds = rows.map((row) => row.menuImport.id);
  const [pageCounts, itemCounts] = await Promise.all([
    db
      .select({ importId: menuImportPages.importId, total: count() })
      .from(menuImportPages)
      .where(inArray(menuImportPages.importId, importIds))
      .groupBy(menuImportPages.importId),
    db
      .select({ importId: menuImportItems.importId, total: count() })
      .from(menuImportItems)
      .where(inArray(menuImportItems.importId, importIds))
      .groupBy(menuImportItems.importId),
  ]);
  const pagesByImport = new Map(
    pageCounts.map((row) => [row.importId, row.total] as const),
  );
  const itemsByImport = new Map(
    itemCounts.map((row) => [row.importId, row.total] as const),
  );

  const scans: DeletedScanSummary[] = [];
  for (const row of rows) {
    if (!row.menuImport.deletedAt) continue;
    scans.push({
      id: row.menuImport.id,
      menuId: row.menuImport.menuId,
      menuTitle: row.menuTitle,
      menuStatus: row.menuStatus,
      status: row.menuImport.status,
      pageCount: pagesByImport.get(row.menuImport.id) ?? 0,
      itemCount: itemsByImport.get(row.menuImport.id) ?? 0,
      createdAt: row.menuImport.createdAt,
      deletedAt: row.menuImport.deletedAt,
      deletedByEmail: row.deletedByEmail,
    });
  }

  return { scans, total, page, pageCount, pageSize };
}

export async function listDeletedItems(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  options: { page?: number } = {},
) {
  await requireAdminActor(db, actorId);

  const settings = await getAppSettings(db);
  await purgeExpiredMenuImports(db, {
    retentionDays: settings.scanRetentionDays,
  });

  const [deletedMenus, deletedScans] = await Promise.all([
    listDeletedMenus(db, restaurantId),
    listDeletedScans(db, restaurantId, { page: options.page }),
  ]);

  return {
    menus: deletedMenus,
    scans: deletedScans.scans,
    scanTotal: deletedScans.total,
    scanPage: deletedScans.page,
    scanPageCount: deletedScans.pageCount,
    scanPageSize: deletedScans.pageSize,
    retentionDays: settings.scanRetentionDays,
  };
}

export async function getDeletedMenuImport(
  db: DbClient,
  actorId: string,
  importId: string,
) {
  await requireAdminActor(db, actorId);

  const [row] = await db
    .select({
      menuImport: menuImports,
      menu: menus,
      deletedByEmail: users.email,
    })
    .from(menuImports)
    .leftJoin(menus, eq(menuImports.menuId, menus.id))
    .leftJoin(users, eq(menuImports.deletedBy, users.id))
    .where(
      and(eq(menuImports.id, importId), isNotNull(menuImports.deletedAt)),
    )
    .limit(1);

  if (!row?.menuImport.deletedAt) {
    throw new NotFoundError("Deleted scan not found.");
  }

  const [pages, items, settings] = await Promise.all([
    db
      .select()
      .from(menuImportPages)
      .where(eq(menuImportPages.importId, importId))
      .orderBy(menuImportPages.pageNumber),
    db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, importId))
      .orderBy(menuImportItems.sortOrder, menuImportItems.createdAt),
    getAppSettings(db),
  ]);

  return {
    import: {
      ...row.menuImport,
      deletedAt: row.menuImport.deletedAt,
    },
    menu: row.menu,
    pages,
    items,
    deletedByEmail: row.deletedByEmail,
    retentionDays: settings.scanRetentionDays,
  };
}

export async function getDeletedMenuImportPage(
  db: DbClient,
  actorId: string,
  importId: string,
  pageId: string,
) {
  await requireAdminActor(db, actorId);

  const [record] = await db
    .select({
      id: menuImports.id,
      restaurantId: menuImports.restaurantId,
    })
    .from(menuImports)
    .where(
      and(eq(menuImports.id, importId), isNotNull(menuImports.deletedAt)),
    )
    .limit(1);

  if (!record) {
    throw new NotFoundError("Deleted scan not found.");
  }

  const [page] = await db
    .select()
    .from(menuImportPages)
    .where(
      and(
        eq(menuImportPages.id, pageId),
        eq(menuImportPages.importId, importId),
      ),
    )
    .limit(1);

  if (!page) {
    throw new NotFoundError("Import page not found.");
  }

  return { import: record, page };
}
