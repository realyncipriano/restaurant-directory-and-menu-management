import "server-only";

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  menuImportItems,
  menuImportPages,
  menuImports,
  menus,
} from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getAppSettings } from "../app-settings";
import { getMenuAccess } from "../menu-access";
import { requireRestaurantPermission } from "../restaurant-access";
import { purgeExpiredMenuImports } from "./purge";

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

  const settings = await getAppSettings(db);
  await purgeExpiredMenuImports(db, {
    retentionDays: settings.scanRetentionDays,
  });

  const rows = await db
    .select({
      menuImport: menuImports,
      menuTitle: menus.title,
      menuStatus: menus.status,
    })
    .from(menuImports)
    .leftJoin(menus, eq(menuImports.menuId, menus.id))
    .where(
      and(
        eq(menuImports.restaurantId, restaurantId),
        isNull(menuImports.deletedAt),
      ),
    )
    .orderBy(desc(menuImports.createdAt));

  return {
    access,
    imports: rows,
    retentionDays: settings.scanRetentionDays,
  };
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
    .where(
      and(eq(menuImports.id, importId), isNull(menuImports.deletedAt)),
    )
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
