import { Pool } from "@neondatabase/serverless";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { ConflictError } from "@/lib/errors";
import {
  menuCategories,
  menuImportItems,
  menuImports,
  menuItems,
  menus,
  users,
} from "@/db/schema";
import { deactivateUser } from "@/server/services/auth";
import {
  acceptAllImportItems,
  applyMenuImport,
  keepOnlyImportCategory,
  updateImportCategoryDecision,
  updateImportItem,
} from "@/server/services/imports";
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

  it("serializes concurrent applies of the same import", async () => {
    const admin = await seedUser(db, {
      email: "import-apply@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Apply Race Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Race Dish",
      basePriceMinor: 12500,
      decision: "accept",
    });

    const results = await Promise.allSettled([
      applyMenuImport(db, admin.id, record!.id),
      applyMenuImport(db, admin.id, record!.id),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const imported = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Race Dish"));
    expect(imported).toHaveLength(1);
    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(applied?.status).toBe("applied");
  });

  it("serializes accept-all against import application", async () => {
    const admin = await seedUser(db, {
      email: "import-accept-race@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Accept Race Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Dinner",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values([
      {
        importId: record!.id,
        categoryName: "Mains",
        name: "Accepted Dish",
        basePriceMinor: 15000,
        decision: "accept",
      },
      {
        importId: record!.id,
        categoryName: "Mains",
        name: "Pending Dish",
        basePriceMinor: 16000,
        decision: "pending",
      },
    ]);

    const [applyResult, acceptResult] = await Promise.allSettled([
      applyMenuImport(db, admin.id, record!.id),
      acceptAllImportItems(db, admin.id, record!.id),
    ]);

    expect(applyResult.status).toBe("fulfilled");
    if (acceptResult.status === "rejected") {
      expect(acceptResult.reason).toBeInstanceOf(ConflictError);
    }
    const accepted = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Accepted Dish"));
    expect(accepted).toHaveLength(1);
    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(applied?.status).toBe("applied");
  });

  it("serializes item edits against import application", async () => {
    const admin = await seedUser(db, {
      email: "import-edit-race@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Edit Race Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Brunch",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Accepted Dish",
      basePriceMinor: 15000,
      decision: "accept",
    });
    const [pending] = await db
      .insert(menuImportItems)
      .values({
        importId: record!.id,
        categoryName: "Mains",
        name: "Pending Dish",
        basePriceMinor: 16000,
        decision: "pending",
      })
      .returning();

    const [applyResult, editResult] = await Promise.allSettled([
      applyMenuImport(db, admin.id, record!.id),
      updateImportItem(db, admin.id, record!.id, pending!.id, {
        decision: "accept",
        categoryName: "Mains",
        name: "Pending Dish",
        basePrice: "160.00",
        availabilityStatus: "available",
      }),
    ]);

    expect(applyResult.status).toBe("fulfilled");
    if (editResult.status === "rejected") {
      expect(editResult.reason).toBeInstanceOf(ConflictError);
    }

    const accepted = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Accepted Dish"));
    const pendingImported = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Pending Dish"));
    expect(accepted).toHaveLength(1);
    expect(pendingImported).toHaveLength(
      editResult.status === "fulfilled" ? 1 : 0,
    );

    const [staged] = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.id, pending!.id));
    expect(staged?.decision).toBe(
      editResult.status === "fulfilled" ? "accept" : "pending",
    );

    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(applied?.status).toBe("applied");
  });

  it("rejects all mutations after an import has been applied", async () => {
    const admin = await seedUser(db, {
      email: "import-applied@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Applied Import Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Supper",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Applied Dish",
      basePriceMinor: 18000,
      decision: "accept",
    });
    const [pending] = await db
      .insert(menuImportItems)
      .values({
        importId: record!.id,
        categoryName: "Mains",
        name: "Later Dish",
        basePriceMinor: 19000,
        decision: "pending",
      })
      .returning();

    await applyMenuImport(db, admin.id, record!.id);

    await expect(
      updateImportItem(db, admin.id, record!.id, pending!.id, {
        decision: "accept",
        categoryName: "Mains",
        name: "Later Dish",
        basePrice: "190.00",
        availabilityStatus: "available",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      acceptAllImportItems(db, admin.id, record!.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateImportCategoryDecision(db, admin.id, record!.id, "Mains", "reject"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      keepOnlyImportCategory(db, admin.id, record!.id, "Mains"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      applyMenuImport(db, admin.id, record!.id),
    ).rejects.toBeInstanceOf(ConflictError);

    const imported = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Applied Dish"));
    const later = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Later Dish"));
    expect(imported).toHaveLength(1);
    expect(later).toHaveLength(0);
  }, 20_000);

  it("rolls back all menu writes when application fails", async () => {
    const admin = await seedUser(db, {
      email: "import-rollback@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Rollback Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Late Night",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Atomic Category",
      name: "Invalid Variant Dish",
      basePriceMinor: null,
      variants: [{ name: "Small", priceMinor: -1 }],
      decision: "accept",
    });

    await expect(
      applyMenuImport(db, admin.id, record!.id),
    ).rejects.toThrow();

    const categories = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.name, "Atomic Category"));
    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Invalid Variant Dish"));
    expect(categories).toHaveLength(0);
    expect(items).toHaveLength(0);

    const [imported] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(imported?.status).toBe("needs_review");
  }, 20_000);
});
