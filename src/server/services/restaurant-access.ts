import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { restaurantUserPermissions, restaurants } from "@/db/schema";
import {
  ALL_PERMISSIONS,
  hasRestaurantPermission,
  type RestaurantPermission,
  type RestaurantPermissionFlags,
} from "@/lib/auth/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireActiveActor } from "./auth";

export type RestaurantRecord = typeof restaurants.$inferSelect;

export type RestaurantAccess = {
  actor: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "authorized_user";
  };
  restaurant: RestaurantRecord;
  flags: RestaurantPermissionFlags;
};

export async function getRestaurantAccess(
  db: DbClient,
  actorId: string,
  restaurantId: string,
): Promise<RestaurantAccess> {
  const actor = await requireActiveActor(db, actorId);

  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  if (!restaurant) {
    throw new NotFoundError("Restaurant not found.");
  }

  if (actor.role === "admin") {
    return {
      actor: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: actor.role,
      },
      restaurant,
      flags: ALL_PERMISSIONS,
    };
  }

  const [permission] = await db
    .select()
    .from(restaurantUserPermissions)
    .where(
      and(
        eq(restaurantUserPermissions.restaurantId, restaurantId),
        eq(restaurantUserPermissions.userId, actor.id),
      ),
    )
    .limit(1);

  if (!permission) {
    throw new NotFoundError("Restaurant not found.");
  }

  return {
    actor: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      role: actor.role,
    },
    restaurant,
    flags: {
      canViewManagementData: permission.canViewManagementData,
      canEditMenu: permission.canEditMenu,
      canPublishMenu: permission.canPublishMenu,
      canManageRestaurant: permission.canManageRestaurant,
    },
  };
}

export async function requireRestaurantPermission(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  permission: RestaurantPermission,
): Promise<RestaurantAccess> {
  const access = await getRestaurantAccess(db, actorId, restaurantId);
  if (!hasRestaurantPermission(access.actor.role, access.flags, permission)) {
    throw new ForbiddenError();
  }
  return access;
}
