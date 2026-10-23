import { and, eq, ne } from "drizzle-orm";

import { menus } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { ConflictError } from "@/lib/errors";
import { slugWithSuffix, slugify } from "@/lib/slug";

export async function menuSlugTaken(
  db: DbExecutor,
  restaurantId: string,
  slug: string,
  excludeLineageId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, restaurantId),
        eq(menus.slug, slug),
        ne(menus.status, "archived"),
        excludeLineageId
          ? ne(menus.lineageId, excludeLineageId)
          : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function uniqueMenuSlug(
  db: DbExecutor,
  restaurantId: string,
  title: string,
): Promise<string> {
  const base = slugify(title, "menu");
  if (!(await menuSlugTaken(db, restaurantId, base))) return base;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = slugWithSuffix(base, suffix);
    if (!(await menuSlugTaken(db, restaurantId, candidate))) {
      return candidate;
    }
  }

  throw new ConflictError(
    "Could not generate a unique menu slug. Enter a different slug.",
  );
}
