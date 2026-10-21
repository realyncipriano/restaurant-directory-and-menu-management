import { and, asc, count, eq, ne } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { isUniqueViolation } from "@/db/pool-errors";
import {
  restaurantUserPermissions,
  restaurants,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import {
  ALL_PERMISSIONS,
  type RestaurantPermissionFlags,
} from "@/lib/auth/permissions";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation/parse";
import {
  permissionUpdateSchema,
  restaurantInputSchema,
} from "@/lib/validation/restaurant";
import { writeAuditLog } from "./audit";
import { requireActiveActor, requireAdminActor } from "./auth";
import {
  getRestaurantAccess,
  requireRestaurantPermission,
  type RestaurantRecord,
} from "./restaurant-access";

export type RestaurantListItem = {
  restaurant: RestaurantRecord;
  flags: RestaurantPermissionFlags;
};

export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  hasAccess: boolean;
  flags: RestaurantPermissionFlags;
};

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "restaurant"
  );
}

async function slugTaken(
  db: DbExecutor,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(
      excludeId
        ? and(eq(restaurants.slug, slug), ne(restaurants.id, excludeId))
        : eq(restaurants.slug, slug),
    )
    .limit(1);
  return Boolean(row);
}

async function uniqueSlug(
  db: DbExecutor,
  desired: string,
): Promise<string> {
  const base = slugify(desired);
  if (!(await slugTaken(db, base))) return base;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${base.slice(0, 80 - String(suffix).length - 1)}-${suffix}`;
    if (!(await slugTaken(db, candidate))) return candidate;
  }

  throw new ConflictError(
    "Could not generate a unique URL slug. Enter a different slug.",
  );
}

export async function listRestaurants(
  db: DbClient,
  actorId: string,
): Promise<RestaurantListItem[]> {
  const actor = await requireActiveActor(db, actorId);

  if (actor.role === "admin") {
    const rows = await db
      .select()
      .from(restaurants)
      .orderBy(asc(restaurants.status), asc(restaurants.name));
    return rows.map((restaurant) => ({
      restaurant,
      flags: ALL_PERMISSIONS,
    }));
  }

  const rows = await db
    .select({
      restaurant: restaurants,
      canViewManagementData: restaurantUserPermissions.canViewManagementData,
      canEditMenu: restaurantUserPermissions.canEditMenu,
      canPublishMenu: restaurantUserPermissions.canPublishMenu,
      canManageRestaurant: restaurantUserPermissions.canManageRestaurant,
    })
    .from(restaurantUserPermissions)
    .innerJoin(
      restaurants,
      eq(restaurantUserPermissions.restaurantId, restaurants.id),
    )
    .where(eq(restaurantUserPermissions.userId, actor.id))
    .orderBy(asc(restaurants.status), asc(restaurants.name));

  return rows.map((row) => ({
    restaurant: row.restaurant,
    flags: {
      canViewManagementData: row.canViewManagementData,
      canEditMenu: row.canEditMenu,
      canPublishMenu: row.canPublishMenu,
      canManageRestaurant: row.canManageRestaurant,
    },
  }));
}

export async function getRestaurantDetail(
  db: DbClient,
  actorId: string,
  restaurantId: string,
) {
  const access = await getRestaurantAccess(db, actorId, restaurantId);

  let accessCount = 0;
  if (access.actor.role === "admin") {
    const [row] = await db
      .select({ total: count() })
      .from(restaurantUserPermissions)
      .where(eq(restaurantUserPermissions.restaurantId, restaurantId));
    accessCount = row?.total ?? 0;
  }

  return { ...access, accessCount };
}

export async function createRestaurant(
  db: DbClient,
  actorId: string,
  input: {
    name: string;
    slug?: string;
    description?: string;
    cuisineType?: string;
    address?: string;
    location?: string;
    contactPhone?: string;
    contactEmail?: string;
    operatingHours?: string;
  },
): Promise<RestaurantRecord> {
  const actor = await requireAdminActor(db, actorId);
  const parsed = parseOrThrow(restaurantInputSchema, input);
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const slug = await uniqueSlug(tx, parsed.slug ?? parsed.name);

      const [restaurant] = await tx
        .insert(restaurants)
        .values({
          name: parsed.name,
          slug,
          description: parsed.description,
          cuisineType: parsed.cuisineType,
          address: parsed.address,
          location: parsed.location,
          contactPhone: parsed.contactPhone,
          contactEmail: parsed.contactEmail,
          operatingHours: parsed.operatingHours,
          currency: "PHP",
          status: "active",
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!restaurant) {
        throw new ConflictError("Could not create the restaurant.");
      }

      await writeAuditLog(tx, {
        actor: { id: actor.id, email: actor.email },
        action: "restaurant_created",
        entityType: "restaurant",
        entityId: restaurant.id,
        details: { name: restaurant.name, slug: restaurant.slug },
      });

      return restaurant;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        "A restaurant with that URL slug already exists.",
      );
    }
    throw error;
  }
}

export async function updateRestaurant(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  input: {
    name: string;
    slug?: string;
    description?: string;
    cuisineType?: string;
    address?: string;
    location?: string;
    contactPhone?: string;
    contactEmail?: string;
    operatingHours?: string;
  },
): Promise<RestaurantRecord> {
  const access = await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "manageRestaurant",
  );
  const parsed = parseOrThrow(restaurantInputSchema, input);
  const current = access.restaurant;

  if (current.status === "archived") {
    throw new ConflictError(
      "Archived restaurants cannot be edited. Reactivate it first.",
    );
  }

  const update: Partial<typeof restaurants.$inferInsert> = {};
  if (parsed.name !== current.name) update.name = parsed.name;
  if (parsed.description !== current.description) {
    update.description = parsed.description;
  }
  if (parsed.cuisineType !== current.cuisineType) {
    update.cuisineType = parsed.cuisineType;
  }
  if (parsed.address !== current.address) update.address = parsed.address;
  if (parsed.location !== current.location) update.location = parsed.location;
  if (parsed.contactPhone !== current.contactPhone) {
    update.contactPhone = parsed.contactPhone;
  }
  if (parsed.contactEmail !== current.contactEmail) {
    update.contactEmail = parsed.contactEmail;
  }
  if (parsed.operatingHours !== current.operatingHours) {
    update.operatingHours = parsed.operatingHours;
  }

  if (parsed.slug && parsed.slug !== current.slug) {
    if (access.actor.role !== "admin") {
      throw new ForbiddenError("Only administrators can change the URL slug.");
    }
    if (await slugTaken(db, parsed.slug, current.id)) {
      throw new ConflictError("That URL slug is already in use.");
    }
    update.slug = parsed.slug;
  }

  if (Object.keys(update).length === 0) {
    return current;
  }

  const now = new Date();
  update.updatedAt = now;

  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(restaurants)
        .set(update)
        .where(eq(restaurants.id, current.id))
        .returning();

      if (!updated) {
        throw new NotFoundError("Restaurant not found.");
      }

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action: "restaurant_updated",
        entityType: "restaurant",
        entityId: current.id,
        details: { fields: Object.keys(update).filter((key) => key !== "updatedAt") },
      });

      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That URL slug is already in use.");
    }
    throw error;
  }
}

export async function setRestaurantArchived(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  archived: boolean,
): Promise<RestaurantRecord> {
  const actor = await requireAdminActor(db, actorId);

  const [current] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  if (!current) {
    throw new NotFoundError("Restaurant not found.");
  }
  if (archived && current.status === "archived") return current;
  if (!archived && current.status === "active") return current;

  const now = new Date();

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(restaurants)
      .set({
        status: archived ? "archived" : "active",
        archivedAt: archived ? now : null,
        updatedAt: now,
      })
      .where(eq(restaurants.id, restaurantId))
      .returning();

    if (!updated) {
      throw new NotFoundError("Restaurant not found.");
    }

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: archived ? "restaurant_archived" : "restaurant_activated",
      entityType: "restaurant",
      entityId: restaurantId,
      details: { name: updated.name },
    });

    return updated;
  });
}

export async function listAssignableUsers(
  db: DbClient,
  actorId: string,
  restaurantId: string,
): Promise<AssignableUser[]> {
  await requireAdminActor(db, actorId);

  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!restaurant) {
    throw new NotFoundError("Restaurant not found.");
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      canViewManagementData: restaurantUserPermissions.canViewManagementData,
      canEditMenu: restaurantUserPermissions.canEditMenu,
      canPublishMenu: restaurantUserPermissions.canPublishMenu,
      canManageRestaurant: restaurantUserPermissions.canManageRestaurant,
    })
    .from(users)
    .leftJoin(
      restaurantUserPermissions,
      and(
        eq(restaurantUserPermissions.userId, users.id),
        eq(restaurantUserPermissions.restaurantId, restaurantId),
      ),
    )
    .where(
      and(
        eq(users.role, "authorized_user"),
        eq(users.accountStatus, "active"),
      ),
    )
    .orderBy(asc(users.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    hasAccess: row.canViewManagementData !== null,
    flags: {
      canViewManagementData: row.canViewManagementData ?? false,
      canEditMenu: row.canEditMenu ?? false,
      canPublishMenu: row.canPublishMenu ?? false,
      canManageRestaurant: row.canManageRestaurant ?? false,
    },
  }));
}

export async function setRestaurantPermission(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  userId: string,
  flags: {
    canEditMenu?: boolean;
    canPublishMenu?: boolean;
    canManageRestaurant?: boolean;
  },
): Promise<void> {
  const actor = await requireAdminActor(db, actorId);
  const parsed = parseOrThrow(permissionUpdateSchema, flags);

  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!restaurant) {
    throw new NotFoundError("Restaurant not found.");
  }

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError("User not found.");
  }
  if (
    target.role !== "authorized_user" ||
    target.accountStatus !== "active"
  ) {
    throw new ConflictError(
      "Permissions can only be granted to active authorized users.",
    );
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(restaurantUserPermissions)
      .values({
        restaurantId,
        userId,
        canViewManagementData: true,
        canEditMenu: parsed.canEditMenu,
        canPublishMenu: parsed.canPublishMenu,
        canManageRestaurant: parsed.canManageRestaurant,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          restaurantUserPermissions.restaurantId,
          restaurantUserPermissions.userId,
        ],
        set: {
          canViewManagementData: true,
          canEditMenu: parsed.canEditMenu,
          canPublishMenu: parsed.canPublishMenu,
          canManageRestaurant: parsed.canManageRestaurant,
          updatedAt: now,
        },
      });

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "permission_granted",
      entityType: "restaurant",
      entityId: restaurantId,
      details: {
        userId,
        email: target.email,
        canEditMenu: parsed.canEditMenu,
        canPublishMenu: parsed.canPublishMenu,
        canManageRestaurant: parsed.canManageRestaurant,
      },
    });
  });
}

export async function removeRestaurantPermission(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  userId: string,
): Promise<void> {
  const actor = await requireAdminActor(db, actorId);

  const [existing] = await db
    .select({ id: restaurantUserPermissions.id })
    .from(restaurantUserPermissions)
    .where(
      and(
        eq(restaurantUserPermissions.restaurantId, restaurantId),
        eq(restaurantUserPermissions.userId, userId),
      ),
    )
    .limit(1);

  if (!existing) return;

  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .delete(restaurantUserPermissions)
      .where(
        and(
          eq(restaurantUserPermissions.restaurantId, restaurantId),
          eq(restaurantUserPermissions.userId, userId),
        ),
      );

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "permission_revoked",
      entityType: "restaurant",
      entityId: restaurantId,
      details: { userId, email: target?.email ?? null },
    });
  });
}
