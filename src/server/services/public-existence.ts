import { eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { menus, restaurants } from "@/db/schema";
import {
  publicMenuCondition,
  publicRestaurantCondition,
} from "./public-visibility";

/**
 * Minimal existence checks used by the Proxy before rendering. These select
 * only a constant and rely on the same visibility predicates as the public
 * directory loaders, without loading menu content or related records.
 */
export async function publicRestaurantExists(
  db: DbClient,
  slug: string,
): Promise<boolean> {
  const [row] = await db
    .select({ found: sql<number>`1` })
    .from(restaurants)
    .where(publicRestaurantCondition(slug))
    .limit(1);

  return row !== undefined;
}

export async function publicMenuExists(
  db: DbClient,
  restaurantSlug: string,
  menuSlug: string,
): Promise<boolean> {
  const [row] = await db
    .select({ found: sql<number>`1` })
    .from(menus)
    .innerJoin(restaurants, eq(menus.restaurantId, restaurants.id))
    .where(publicMenuCondition(restaurantSlug, menuSlug))
    .limit(1);

  return row !== undefined;
}
