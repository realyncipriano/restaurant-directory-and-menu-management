import { Pool } from "@neondatabase/serverless";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { menus, users } from "@/db/schema";
import { deactivateUser } from "@/server/services/auth";
import {
  createCategory,
  createMenuItem,
} from "@/server/services/menu-content";
import { createMenu, publishMenu } from "@/server/services/menus";
import { createRestaurant } from "@/server/services/restaurants";
import { seedUser } from "../helpers/db";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration("database concurrency (dedicated test database)", () => {
  let pool: Pool;
  let db: DbClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: connectionString! });
    db = drizzle(pool) as unknown as DbClient;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE
        audit_logs,
        menu_change_logs,
        menu_import_items,
        menu_import_pages,
        menu_imports,
        menu_item_modifiers,
        menu_item_variants,
        menu_items,
        menu_categories,
        menus,
        restaurant_user_permissions,
        restaurants,
        auth_tokens,
        sessions,
        rate_limits,
        app_settings,
        users
      RESTART IDENTITY CASCADE
    `);
  });

  it("never leaves zero active administrators", async () => {
    const first = await seedUser(db, {
      email: "first-admin@example.com",
      role: "admin",
    });
    const second = await seedUser(db, {
      email: "second-admin@example.com",
      role: "admin",
    });

    const results = await Promise.allSettled([
      deactivateUser(db, {
        actorId: first.id,
        userId: second.id,
      }),
      deactivateUser(db, {
        actorId: second.id,
        userId: first.id,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const [active] = await db
      .select({ total: count() })
      .from(users)
      .where(eq(users.accountStatus, "active"));
    expect(active?.total).toBe(1);
  });

  it("serializes concurrent publishes of the same draft", async () => {
    const admin = await seedUser(db, {
      email: "publisher@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Concurrent Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Dinner",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, {
      categoryId: category.id,
      name: "Priced Dish",
      description: null,
      basePrice: 10000,
      availabilityStatus: "available",
      sortOrder: 10,
      variants: [],
      modifiers: [],
    });

    const results = await Promise.allSettled([
      publishMenu(db, admin.id, menu.id),
      publishMenu(db, admin.id, menu.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const published = await db
      .select({ id: menus.id })
      .from(menus)
      .where(eq(menus.status, "published"));
    expect(published).toHaveLength(1);
  });
});
