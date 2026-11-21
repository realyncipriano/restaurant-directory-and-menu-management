import { and, eq } from "drizzle-orm";

import { menus, restaurants } from "@/db/schema";

/**
 * Public visibility predicates shared by the directory loaders and the
 * request-time Proxy existence checks. Keeping these in one place prevents
 * the Proxy from admitting resources the page will reject (or vice versa).
 */
export function publicRestaurantCondition(slug: string) {
  return and(
    eq(restaurants.slug, slug),
    eq(restaurants.status, "active"),
  );
}

export function publicMenuCondition(
  restaurantSlug: string,
  menuSlug: string,
) {
  return and(
    eq(restaurants.slug, restaurantSlug),
    eq(restaurants.status, "active"),
    eq(menus.slug, menuSlug),
    eq(menus.status, "published"),
  );
}
