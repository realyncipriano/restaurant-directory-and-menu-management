import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { DbClient } from "@/db/client";
import { menus, restaurants } from "@/db/schema";
import {
  publicMenuExists,
  publicRestaurantExists,
} from "@/server/services/public-existence";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb } from "../helpers/db";

describe("public existence checks (ephemeral PGlite)", () => {
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

  it("treats only active restaurants as public", async () => {
    const [active] = await db
      .insert(restaurants)
      .values({
        name: "Active Kitchen",
        slug: "active-kitchen",
        status: "active",
      })
      .returning();
    const [archived] = await db
      .insert(restaurants)
      .values({
        name: "Archived Kitchen",
        slug: "archived-kitchen",
        status: "archived",
      })
      .returning();

    expect(await publicRestaurantExists(db, active!.slug)).toBe(true);
    expect(await publicRestaurantExists(db, archived!.slug)).toBe(false);
    expect(await publicRestaurantExists(db, "missing-kitchen")).toBe(
      false,
    );
  });

  it("treats only published menus under active restaurants as public", async () => {
    const [active] = await db
      .insert(restaurants)
      .values({
        name: "Active Kitchen",
        slug: "active-kitchen",
        status: "active",
      })
      .returning();
    const [archived] = await db
      .insert(restaurants)
      .values({
        name: "Archived Kitchen",
        slug: "archived-kitchen",
        status: "archived",
      })
      .returning();

    await db.insert(menus).values([
      {
        restaurantId: active!.id,
        title: "Lunch",
        slug: "lunch",
        status: "published",
        publishedAt: new Date(),
      },
      {
        restaurantId: active!.id,
        title: "Draft Dinner",
        slug: "draft-dinner",
        status: "draft",
      },
      {
        restaurantId: active!.id,
        title: "Old Specials",
        slug: "old-specials",
        status: "archived",
      },
      {
        restaurantId: archived!.id,
        title: "Secret Menu",
        slug: "secret-menu",
        status: "published",
        publishedAt: new Date(),
      },
    ]);

    expect(
      await publicMenuExists(db, "active-kitchen", "lunch"),
    ).toBe(true);
    expect(
      await publicMenuExists(db, "active-kitchen", "draft-dinner"),
    ).toBe(false);
    expect(
      await publicMenuExists(db, "active-kitchen", "old-specials"),
    ).toBe(false);
    expect(
      await publicMenuExists(db, "archived-kitchen", "secret-menu"),
    ).toBe(false);
    expect(
      await publicMenuExists(db, "active-kitchen", "secret-menu"),
    ).toBe(false);
    expect(
      await publicMenuExists(db, "active-kitchen", "missing-menu"),
    ).toBe(false);
  });
});
