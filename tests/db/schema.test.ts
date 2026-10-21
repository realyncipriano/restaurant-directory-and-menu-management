import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  menuCategories,
  menuItems,
  menus,
  restaurants,
  users,
} from "@/db/schema";

import { createEphemeralDb, type EphemeralDb } from "./ephemeral-db";

describe("database schema (ephemeral PGlite, never touches configured databases)", () => {
  let handle: EphemeralDb;

  beforeAll(async () => {
    handle = await createEphemeralDb();
  });

  afterAll(async () => {
    await handle.client.close();
  });

  it("applies all migrations and enforces case-insensitive unique emails", async () => {
    const { db } = handle;

    await db.insert(users).values({
      name: "Admin One",
      email: "Admin@Example.com",
      role: "admin",
      accountStatus: "active",
    });

    await expect(
      db.insert(users).values({
        name: "Admin Two",
        email: "admin@example.COM",
        role: "authorized_user",
        accountStatus: "active",
      }),
    ).rejects.toThrow();
  });

  it("allows multiple published menus but only one per lineage", async () => {
    const { db } = handle;

    const [restaurant] = await db
      .insert(restaurants)
      .values({
        name: "Test Kitchen",
        slug: "test-kitchen",
        currency: "PHP",
      })
      .returning();
    expect(restaurant).toBeDefined();

    await db.insert(menus).values([
      {
        restaurantId: restaurant!.id,
        title: "Breakfast",
        slug: "breakfast",
        status: "published",
        lineageId: "00000000-0000-4000-8000-000000000001",
        publishedAt: new Date(),
        lastUpdatedAt: new Date(),
      },
      {
        restaurantId: restaurant!.id,
        title: "Dinner",
        slug: "dinner",
        status: "published",
        lineageId: "00000000-0000-4000-8000-000000000002",
        publishedAt: new Date(),
        lastUpdatedAt: new Date(),
      },
    ]);

    await expect(
      db.insert(menus).values({
        restaurantId: restaurant!.id,
        title: "Breakfast v2",
        slug: "breakfast-v2",
        status: "published",
        lineageId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow();
  });

  it("enforces non-negative prices and cascading menu deletion", async () => {
    const { db } = handle;

    const [restaurant] = await db
      .insert(restaurants)
      .values({ name: "Price Test", slug: "price-test" })
      .returning();

    const [menu] = await db
      .insert(menus)
      .values({
        restaurantId: restaurant!.id,
        title: "Lunch",
        slug: "lunch",
        lineageId: "00000000-0000-4000-8000-000000000003",
      })
      .returning();

    const [category] = await db
      .insert(menuCategories)
      .values({ menuId: menu!.id, name: "Meals", sortOrder: 0 })
      .returning();

    await expect(
      db.insert(menuItems).values({
        categoryId: category!.id,
        name: "Invalid",
        basePriceMinor: -1,
      }),
    ).rejects.toThrow();

    const [item] = await db
      .insert(menuItems)
      .values({
        categoryId: category!.id,
        name: "Valid",
        basePriceMinor: 9900,
        currency: "PHP",
      })
      .returning();
    expect(item).toBeDefined();

    await db.delete(menus).where(eq(menus.id, menu!.id));
    const remaining = await db.select().from(menuItems);
    expect(remaining).toHaveLength(0);
  });
});
