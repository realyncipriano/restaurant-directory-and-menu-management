import { eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
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
