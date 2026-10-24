import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { menus } from "@/db/schema";
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

function item(
  categoryId: string,
  name: string,
  overrides: Partial<ItemInput> = {},
): ItemInput {
  return {
    categoryId,
    name,
    description: null,
    basePrice: 9000,
    availabilityStatus: "available",
    sortOrder: 0,
    variants: [],
    modifiers: [],
    ...overrides,
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
    await createMenuItem(
      db,
      admin.id,
      menu.id,
      item(category.id, "Adobo", {
        variants: [
          { name: "Regular", price: 9000 },
          { name: "Large", price: 12000 },
        ],
        modifiers: [
          { name: "Extra rice", price: 2500, isAvailable: true },
          { name: "Egg", price: 1500, isAvailable: false },
        ],
      }),
    );
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
    expect(detail?.menus[0]?.categories.map((category) => category.name)).toEqual([
      "Mains",
    ]);

    const adobo = detail?.menus[0]?.categories[0]?.items[0];
    expect(adobo?.name).toBe("Adobo");
    expect(adobo?.variants.map((variant) => variant.name)).toEqual([
      "Regular",
      "Large",
    ]);
    expect(adobo?.modifiers.map((modifier) => modifier.name)).toEqual([
      "Extra rice",
      "Egg",
    ]);
    expect(adobo?.modifiers[1]?.isAvailable).toBe(false);
    expect(detail?.menus.some((entry) => entry.id === draft.id)).toBe(false);

    await setRestaurantArchived(db, admin.id, restaurant.id, true);
    expect(await getPublicRestaurant(db, restaurant.slug)).toBeNull();
  });

  it("returns every published menu with ordered categories and items", async () => {
    const { admin, restaurant, menu } = await seedPublishedRestaurant();
    const dinner = await createMenu(db, admin.id, restaurant.id, {
      title: "Dinner",
    });
    await createCategory(db, admin.id, dinner.id, {
      name: "Specials",
      sortOrder: 0,
    });
    const mains = await createCategory(db, admin.id, dinner.id, {
      name: "Mains",
      sortOrder: 1,
    });
    const drinks = await createCategory(db, admin.id, dinner.id, {
      name: "Drinks",
      sortOrder: 2,
    });
    await createMenuItem(
      db,
      admin.id,
      dinner.id,
      item(mains.id, "Sinigang", { sortOrder: 1, basePrice: 15000 }),
    );
    await createMenuItem(
      db,
      admin.id,
      dinner.id,
      item(mains.id, "Kare-kare", { sortOrder: 0, basePrice: 18000 }),
    );
    await createMenuItem(
      db,
      admin.id,
      dinner.id,
      item(drinks.id, "Juice", {
        sortOrder: 0,
        availabilityStatus: "unavailable",
      }),
    );
    await publishMenu(db, admin.id, dinner.id);

    const detail = await getPublicRestaurant(db, restaurant.slug);
    expect(detail?.menus).toHaveLength(2);

    const mainMenu = detail?.menus.find((entry) => entry.id === menu.id);
    const dinnerMenu = detail?.menus.find((entry) => entry.id === dinner.id);

    expect(mainMenu?.itemCount).toBe(1);
    expect(dinnerMenu?.categories.map((category) => category.name)).toEqual([
      "Specials",
      "Mains",
      "Drinks",
    ]);
    expect(dinnerMenu?.categories[0]?.items).toEqual([]);
    expect(
      dinnerMenu?.categories[1]?.items.map((entry) => entry.name),
    ).toEqual(["Kare-kare", "Sinigang"]);
    expect(dinnerMenu?.categories[2]?.items[0]?.availabilityStatus).toBe(
      "unavailable",
    );
    expect(dinnerMenu?.itemCount).toBe(3);
  });

  it("includes published menus without categories", async () => {
    const { admin, restaurant } = await seedPublishedRestaurant();
    const [emptyMenu] = await db
      .insert(menus)
      .values({
        restaurantId: restaurant.id,
        title: "Specials",
        slug: "specials",
        status: "published",
        publishedAt: new Date(),
        lastUpdatedAt: new Date(),
        createdBy: admin.id,
      })
      .returning();
    expect(emptyMenu).toBeDefined();

    const detail = await getPublicRestaurant(db, restaurant.slug);
    const entry = detail?.menus.find(
      (menuEntry) => menuEntry.id === emptyMenu?.id,
    );

    expect(entry?.categories).toEqual([]);
    expect(entry?.itemCount).toBe(0);
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
