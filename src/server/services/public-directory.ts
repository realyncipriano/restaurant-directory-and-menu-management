import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  or,
} from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { menus, restaurants } from "@/db/schema";
import type {
  MenuRecord,
  MenuTreeCategory,
} from "./menu-tree";
import { loadMenuTree, loadMenuTreesForRecords } from "./menu-tree";

export type PublicRestaurantCard = {
  restaurant: typeof restaurants.$inferSelect;
  publishedMenuCount: number;
};

export type PublicMenu = MenuRecord & {
  categories: MenuTreeCategory[];
  itemCount: number;
};

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listPublicRestaurants(
  db: DbClient,
  filters: { search?: string; cuisine?: string } = {},
): Promise<PublicRestaurantCard[]> {
  const search = filters.search?.trim().slice(0, 100);
  const cuisine = filters.cuisine?.trim().slice(0, 80);
  const searchPattern = search ? `%${escapeLikePattern(search)}%` : undefined;

  const where = and(
    eq(restaurants.status, "active"),
    cuisine ? eq(restaurants.cuisineType, cuisine) : undefined,
    searchPattern
      ? or(
          ilike(restaurants.name, searchPattern),
          ilike(restaurants.cuisineType, searchPattern),
          ilike(restaurants.location, searchPattern),
          ilike(restaurants.description, searchPattern),
        )
      : undefined,
  );

  const rows = await db
    .select({
      restaurant: restaurants,
      publishedMenuCount: count(menus.id),
    })
    .from(restaurants)
    .leftJoin(
      menus,
      and(
        eq(menus.restaurantId, restaurants.id),
        eq(menus.status, "published"),
      ),
    )
    .where(where)
    .groupBy(restaurants.id)
    .orderBy(asc(restaurants.name))
    .limit(100);

  return rows.map((row) => ({
    restaurant: row.restaurant,
    publishedMenuCount: row.publishedMenuCount,
  }));
}

export async function listPublicCuisines(db: DbClient): Promise<string[]> {
  const rows = await db
    .selectDistinct({ cuisine: restaurants.cuisineType })
    .from(restaurants)
    .where(
      and(
        eq(restaurants.status, "active"),
        isNotNull(restaurants.cuisineType),
      ),
    )
    .orderBy(asc(restaurants.cuisineType));

  return rows
    .map((row) => row.cuisine)
    .filter((cuisine): cuisine is string => Boolean(cuisine));
}

export async function getPublicRestaurant(
  db: DbClient,
  slug: string,
) {
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(
      and(
        eq(restaurants.slug, slug),
        eq(restaurants.status, "active"),
      ),
    )
    .limit(1);

  if (!restaurant) return null;

  const publishedMenus = await db
    .select()
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, restaurant.id),
        eq(menus.status, "published"),
      ),
    )
    .orderBy(desc(menus.publishedAt), asc(menus.title));

  const trees = await loadMenuTreesForRecords(db, publishedMenus);

  const menuCards: PublicMenu[] = publishedMenus.map((menu) => {
    const categories = trees.get(menu.id)?.categories ?? [];
    const itemCount = categories.reduce(
      (total, category) => total + category.items.length,
      0,
    );

    return {
      ...menu,
      categories,
      itemCount,
    };
  });

  return { restaurant, menus: menuCards };
}

export async function getPublicMenu(
  db: DbClient,
  restaurantSlug: string,
  menuSlug: string,
) {
  const [row] = await db
    .select({ restaurant: restaurants, menu: menus })
    .from(menus)
    .innerJoin(restaurants, eq(menus.restaurantId, restaurants.id))
    .where(
      and(
        eq(restaurants.slug, restaurantSlug),
        eq(restaurants.status, "active"),
        eq(menus.slug, menuSlug),
        eq(menus.status, "published"),
      ),
    )
    .limit(1);

  if (!row) return null;

  const tree = await loadMenuTree(db, row.menu.id);
  if (!tree) return null;

  return { restaurant: row.restaurant, tree };
}

export async function listPublishedMenuSlugs(
  db: DbClient,
  restaurantId: string,
): Promise<string[]> {
  const rows = await db
    .select({ slug: menus.slug })
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, restaurantId),
        eq(menus.status, "published"),
      ),
    );
  return rows.map((row) => row.slug);
}

export async function listActiveRestaurantSlugs(
  db: DbClient,
): Promise<string[]> {
  const rows = await db
    .select({ slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.status, "active"));
  return rows.map((row) => row.slug);
}
