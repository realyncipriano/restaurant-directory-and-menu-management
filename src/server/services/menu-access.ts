import { asc, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import type { DbExecutor } from "@/db/types";
import { menus } from "@/db/schema";
import {
  hasRestaurantPermission,
  type RestaurantPermission,
} from "@/lib/auth/permissions";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import {
  getRestaurantAccess,
  type RestaurantAccess,
} from "./restaurant-access";
import type { MenuRecord } from "./menu-tree";

export type MenuAccess = {
  menu: MenuRecord;
  access: RestaurantAccess;
};

export async function getMenuAccess(
  db: DbClient,
  actorId: string,
  menuId: string,
): Promise<MenuAccess> {
  const [menu] = await db
    .select()
    .from(menus)
    .where(eq(menus.id, menuId))
    .limit(1);

  if (!menu) {
    throw new NotFoundError("Menu not found.");
  }

  const access = await getRestaurantAccess(db, actorId, menu.restaurantId);
  return { menu, access };
}

export async function requireMenuPermission(
  db: DbClient,
  actorId: string,
  menuId: string,
  permission: RestaurantPermission,
): Promise<MenuAccess> {
  const result = await getMenuAccess(db, actorId, menuId);
  const { access } = result;

  if (
    !hasRestaurantPermission(access.actor.role, access.flags, permission)
  ) {
    throw new ForbiddenError();
  }

  return result;
}

export async function requireDraftEditable(
  db: DbClient,
  actorId: string,
  menuId: string,
): Promise<MenuAccess> {
  const result = await requireMenuPermission(
    db,
    actorId,
    menuId,
    "editMenu",
  );

  if (result.access.restaurant.status !== "active") {
    throw new ConflictError(
      "This restaurant is archived. Reactivate it before editing menus.",
    );
  }
  if (result.menu.status !== "draft") {
    throw new ConflictError(
      "Published menus are read-only. Create a draft revision to make changes.",
    );
  }

  return result;
}

const MENU_LINEAGE_LOCK_PREFIX = "rdmm.menu-lineage:";

/**
 * Serializes every lifecycle change for a menu lineage. Locking existing menu
 * rows is not enough because a concurrent create-draft can insert a new version
 * that was not present when the transaction started.
 */
export async function lockMenuLineage(
  tx: DbExecutor,
  lineageId: string,
): Promise<void> {
  const lockKey = `${MENU_LINEAGE_LOCK_PREFIX}${lineageId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`,
  );
}

export async function lockMenuLineageRows(
  tx: DbExecutor,
  lineageId: string,
): Promise<MenuRecord[]> {
  return tx
    .select()
    .from(menus)
    .where(eq(menus.lineageId, lineageId))
    .orderBy(asc(menus.id))
    .for("update");
}

export async function lockMenuRow(
  tx: DbExecutor,
  menuId: string,
): Promise<MenuRecord> {
  await tx.execute(
    sql`select id from ${menus} where ${menus.id} = ${menuId} for update`,
  );

  const [menu] = await tx
    .select()
    .from(menus)
    .where(eq(menus.id, menuId))
    .limit(1);

  if (!menu) {
    throw new NotFoundError("Menu not found.");
  }

  return menu;
}

export async function lockDraftMenu(
  tx: DbExecutor,
  menuId: string,
): Promise<MenuRecord> {
  const menu = await lockMenuRow(tx, menuId);
  if (menu.status !== "draft") {
    throw new ConflictError(
      "Published menus are read-only. Create a draft revision to make changes.",
    );
  }
  return menu;
}
