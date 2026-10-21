import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  restaurantUserPermissions,
  restaurants,
} from "@/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import {
  createRestaurant,
  getRestaurantDetail,
  listAssignableUsers,
  listRestaurants,
  removeRestaurantPermission,
  setRestaurantArchived,
  setRestaurantPermission,
  updateRestaurant,
} from "@/server/services/restaurants";
import { getRestaurantAccess } from "@/server/services/restaurant-access";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

describe("restaurant services (ephemeral PGlite)", () => {
  let handle: EphemeralDb;
  let db: DbClient;

  beforeAll(async () => {
    const opened = await openTestDb();
    handle = opened.handle;
    db = opened.db;
  });

  afterAll(async () => {
    await handle.client.close();
  });

  beforeEach(async () => {
    await resetTestDb(handle);
  });

  async function admin() {
    return seedUser(db, { email: "admin@example.com", role: "admin" });
  }

  it("creates restaurants with unique auto-generated slugs and audits them", async () => {
    const actor = await admin();

    const first = await createRestaurant(db, actor.id, {
      name: "Lola Maria's Kitchen",
      description: "Home-style Filipino food.",
      location: "Makati City",
    });
    const second = await createRestaurant(db, actor.id, {
      name: "Lola Maria's Kitchen",
    });

    expect(first.slug).toBe("lola-maria-s-kitchen");
    expect(second.slug).toBe("lola-maria-s-kitchen-2");
    expect(first.currency).toBe("PHP");
    expect(first.status).toBe("active");

    const logs = await db.select().from(auditLogs);
    expect(logs.filter((log) => log.action === "restaurant_created")).toHaveLength(
      2,
    );
  });

  it("rejects restaurant creation by authorized users", async () => {
    const member = await seedUser(db, { email: "member@example.com" });

    await expect(
      createRestaurant(db, member.id, { name: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scopes listing and access to granted restaurants", async () => {
    const actor = await admin();
    const member = await seedUser(db, { email: "member@example.com" });
    const other = await seedUser(db, { email: "other@example.com" });

    const visible = await createRestaurant(db, actor.id, { name: "Visible" });
    await createRestaurant(db, actor.id, { name: "Hidden" });

    await setRestaurantPermission(db, actor.id, visible.id, member.id, {
      canEditMenu: true,
    });
    await setRestaurantPermission(db, actor.id, visible.id, other.id, {});

    const memberRows = await listRestaurants(db, member.id);
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.restaurant.id).toBe(visible.id);
    expect(memberRows[0]?.flags.canEditMenu).toBe(true);
    expect(memberRows[0]?.flags.canPublishMenu).toBe(false);

    const adminRows = await listRestaurants(db, actor.id);
    expect(adminRows).toHaveLength(2);

    await expect(
      getRestaurantAccess(db, member.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets profile managers edit details but not change the slug", async () => {
    const actor = await admin();
    const member = await seedUser(db, { email: "manager@example.com" });
    const restaurant = await createRestaurant(db, actor.id, {
      name: "Managed",
    });

    await setRestaurantPermission(db, actor.id, restaurant.id, member.id, {
      canManageRestaurant: true,
    });

    const updated = await updateRestaurant(db, member.id, restaurant.id, {
      name: "Managed Kitchen",
      description: "Updated",
      contactEmail: "HELLO@Example.com",
    });

    expect(updated.name).toBe("Managed Kitchen");
    expect(updated.contactEmail).toBe("hello@example.com");
    expect(updated.slug).toBe(restaurant.slug);

    await expect(
      updateRestaurant(db, member.id, restaurant.id, {
        name: "Managed Kitchen",
        slug: "changed-slug",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires manage permission and blocks edits to archived restaurants", async () => {
    const actor = await admin();
    const member = await seedUser(db, { email: "viewer@example.com" });
    const restaurant = await createRestaurant(db, actor.id, { name: "Archive Me" });

    await setRestaurantPermission(db, actor.id, restaurant.id, member.id, {
      canEditMenu: true,
    });

    await expect(
      updateRestaurant(db, member.id, restaurant.id, { name: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await setRestaurantArchived(db, actor.id, restaurant.id, true);
    await expect(
      updateRestaurant(db, actor.id, restaurant.id, { name: "Still archived" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const access = await getRestaurantAccess(db, member.id, restaurant.id);
    expect(access.restaurant.status).toBe("archived");

    await setRestaurantArchived(db, actor.id, restaurant.id, false);
    const restored = await getRestaurantAccess(db, actor.id, restaurant.id);
    expect(restored.restaurant.status).toBe("active");
    expect(restored.restaurant.archivedAt).toBeNull();
  });

  it("requires admin for archiving and permission changes", async () => {
    const actor = await admin();
    const member = await seedUser(db, { email: "member@example.com" });
    const restaurant = await createRestaurant(db, actor.id, { name: "Locked" });

    await expect(
      setRestaurantArchived(db, member.id, restaurant.id, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setRestaurantPermission(db, member.id, restaurant.id, member.id, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      listAssignableUsers(db, member.id, restaurant.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("upserts and removes permissions, rejecting inactive targets", async () => {
    const actor = await admin();
    const member = await seedUser(db, { email: "member@example.com" });
    const invited = await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
      password: null,
    });
    const restaurant = await createRestaurant(db, actor.id, { name: "Team" });

    await setRestaurantPermission(db, actor.id, restaurant.id, member.id, {
      canEditMenu: true,
      canPublishMenu: false,
    });
    await setRestaurantPermission(db, actor.id, restaurant.id, member.id, {
      canEditMenu: false,
      canPublishMenu: true,
    });

    const rows = await db
      .select()
      .from(restaurantUserPermissions)
      .where(eq(restaurantUserPermissions.restaurantId, restaurant.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.canEditMenu).toBe(false);
    expect(rows[0]?.canPublishMenu).toBe(true);

    const assignable = await listAssignableUsers(db, actor.id, restaurant.id);
    expect(assignable).toHaveLength(1);
    expect(assignable[0]?.hasAccess).toBe(true);

    await removeRestaurantPermission(db, actor.id, restaurant.id, member.id);
    const after = await db
      .select()
      .from(restaurantUserPermissions)
      .where(eq(restaurantUserPermissions.restaurantId, restaurant.id));
    expect(after).toHaveLength(0);

    await expect(
      setRestaurantPermission(db, actor.id, restaurant.id, invited.id, {}),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("renames slugs and rejects duplicates", async () => {
    const actor = await admin();
    const first = await createRestaurant(db, actor.id, { name: "First" });
    const second = await createRestaurant(db, actor.id, { name: "Second" });

    await expect(
      updateRestaurant(db, actor.id, second.id, {
        name: "Second",
        slug: first.slug,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const updated = await updateRestaurant(db, actor.id, second.id, {
      name: "Second",
      slug: "second-renamed",
    });
    expect(updated.slug).toBe("second-renamed");
  });

  it("counts restaurant access for admins", async () => {
    const actor = await admin();
    const member = await seedUser(db, { email: "member@example.com" });
    const restaurant = await createRestaurant(db, actor.id, { name: "Count" });
    await setRestaurantPermission(db, actor.id, restaurant.id, member.id, {});

    const detail = await getRestaurantDetail(db, actor.id, restaurant.id);
    expect(detail.accessCount).toBe(1);

    const stored = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, restaurant.id));
    expect(stored[0]?.status).toBe("active");
  });
});
