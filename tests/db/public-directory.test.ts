import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  getPublicMenu,
  getPublicRestaurant,
  listPublicCuisines,
  listPublicRestaurants,
} from "@/server/services/public-directory";
import {
  createMenu,
  publishMenu,
  startEditingMenu,
  updateMenuSettings,
} from "@/server/services/menus";
import {
  createCategory,
  createMenuItem,
} from "@/server/services/menu-content";
import {
  createRestaurant,
  setRestaurantArchived,
} from "@/server/services/restaurants";
import type { ItemInput } from "@/lib/validation/menu";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

function item(categoryId: string, name: string): ItemInput {
  return {
    categoryId,
    name,
    description: null,
    basePrice: 9000,
    availabilityStatus: "available",
    sortOrder: 0,
    variants: [],
    modifiers: [],
  };
}

describe("public directory queries (ephemeral PGlite)", () => {
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

  async function seedPublishedRestaurant() {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Public Kitchen",
      description: "Filipino comfort food.",
      cuisineType: "Filipino",
      location: "Makati City",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, item(category.id, "Adobo"));
    await publishMenu(db, admin.id, menu.id);

    return { admin, restaurant, menu };
  }

  it("lists only active restaurants with search and cuisine filters", async () => {
    const { admin, restaurant } = await seedPublishedRestaurant();
    const other = await createRestaurant(db, admin.id, {
      name: "Hidden Diner",
      cuisineType: "Japanese",
    });
    await setRestaurantArchived(db, admin.id, other.id, true);

    const all = await listPublicRestaurants(db);
    expect(all).toHaveLength(1);
    expect(all[0]?.restaurant.id).toBe(restaurant.id);
    expect(all[0]?.publishedMenuCount).toBe(1);

    const search = await listPublicRestaurants(db, { search: "adobo" });
    expect(search).toHaveLength(0);

    const byName = await listPublicRestaurants(db, { search: "public" });
    expect(byName).toHaveLength(1);

    const byCuisine = await listPublicRestaurants(db, {
      cuisine: "Filipino",
    });
    expect(byCuisine).toHaveLength(1);

    const noMatch = await listPublicRestaurants(db, {
      cuisine: "Japanese",
    });
    expect(noMatch).toHaveLength(0);

    const cuisines = await listPublicCuisines(db);
    expect(cuisines).toEqual(["Filipino"]);
  });

  it("returns restaurant details with published menus only", async () => {
    const { admin, restaurant, menu } = await seedPublishedRestaurant();
    const draft = await startEditingMenu(db, admin.id, menu.id);

    const detail = await getPublicRestaurant(db, restaurant.slug);
    expect(detail).not.toBeNull();
    expect(detail?.menus).toHaveLength(1);
    expect(detail?.menus[0]?.id).toBe(menu.id);
    expect(detail?.menus[0]?.itemCount).toBe(1);
    expect(detail?.menus.some((entry) => entry.id === draft.id)).toBe(false);

    await setRestaurantArchived(db, admin.id, restaurant.id, true);
    expect(await getPublicRestaurant(db, restaurant.slug)).toBeNull();
  });

  it("serves published menus and rejects drafts or archived parents", async () => {
    const { admin, restaurant, menu } = await seedPublishedRestaurant();

    const published = await getPublicMenu(db, restaurant.slug, menu.slug);
    expect(published).not.toBeNull();
    expect(published?.tree.categories[0]?.items[0]?.name).toBe("Adobo");

    const draft = await startEditingMenu(db, admin.id, menu.id);
    await updateMenuSettings(db, admin.id, draft.id, {
      title: "Lunch draft",
      slug: "lunch-draft",
    });
    expect(
      await getPublicMenu(db, restaurant.slug, "lunch-draft"),
    ).toBeNull();

    await setRestaurantArchived(db, admin.id, restaurant.id, true);
    expect(
      await getPublicMenu(db, restaurant.slug, menu.slug),
    ).toBeNull();
  });
});
