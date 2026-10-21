import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  menuCategories,
  menuImportItems,
  menuImports,
  menuItemModifiers,
  menuItems,
  menuItemVariants,
  menus,
} from "@/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { ItemInput } from "@/lib/validation/menu";
import {
  applyMenuImport,
  updateImportItem,
} from "@/server/services/imports";
import { createMenuItem } from "@/server/services/menu-content";
import { createMenu } from "@/server/services/menus";
import {
  createRestaurant,
  setRestaurantPermission,
} from "@/server/services/restaurants";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

function itemInput(
  categoryId: string,
  overrides: Partial<ItemInput> = {},
): ItemInput {
  return {
    categoryId,
    name: "Chicken Adobo",
    description: "Braised chicken",
    basePrice: 18500,
    availabilityStatus: "available",
    sortOrder: 10,
    variants: [],
    modifiers: [],
    ...overrides,
  };
}

describe("menu import application (ephemeral PGlite)", () => {
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

  async function setup() {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const viewer = await seedUser(db, { email: "viewer@example.com" });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Import Test Kitchen",
    });
    await setRestaurantPermission(db, admin.id, restaurant.id, viewer.id, {});
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });

    const category = await db
      .insert(menuCategories)
      .values({ menuId: menu.id, name: "Mains" })
      .returning();
    const existing = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category[0]!.id),
    );
    const omitted = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category[0]!.id, { name: "Omitted From Scan" }),
    );

    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();

    return {
      admin,
      viewer,
      restaurant,
      menu,
      category: category[0]!,
      existing,
      omitted,
      record: record!,
    };
  }

  it("updates matched items, creates new items and keeps omitted items", async () => {
    const { admin, menu, existing, omitted, record } = await setup();

    const [updatedStage] = await db
      .insert(menuImportItems)
      .values({
        importId: record.id,
        categoryName: "Mains",
        name: "Chicken Adobo",
        basePriceMinor: 20000,
        matchedMenuItemId: existing.id,
        matchedLogicalId: existing.logicalId,
        changeType: "price_changed",
        decision: "accept",
      })
      .returning();
    const [newStage] = await db
      .insert(menuImportItems)
      .values({
        importId: record.id,
        categoryName: "Desserts",
        name: "Halo-Halo",
        basePriceMinor: 12000,
        changeType: "new",
        decision: "accept",
      })
      .returning();
    const [rejected] = await db
      .insert(menuImportItems)
      .values({
        importId: record.id,
        categoryName: "Mains",
        name: "Rejected Item",
        basePriceMinor: 5000,
        decision: "reject",
      })
      .returning();

    const menuId = await applyMenuImport(db, admin.id, record.id);
    expect(menuId).toBe(menu.id);

    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, existing.id));
    expect(items[0]?.basePriceMinor).toBe(20000);
    expect(items[0]?.logicalId).toBe(existing.logicalId);

    const omittedRow = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, omitted.id));
    expect(omittedRow).toHaveLength(1);

    const created = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Halo-Halo"));
    expect(created).toHaveLength(1);

    const categories = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.menuId, menu.id));
    expect(categories.map((category) => category.name)).toContain("Desserts");

    const rejectedRows = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Rejected Item"));
    expect(rejectedRows).toHaveLength(0);

    expect(updatedStage?.id).toBeTruthy();
    expect(newStage?.id).toBeTruthy();
    expect(rejected?.id).toBeTruthy();

    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record.id));
    expect(applied?.status).toBe("applied");
    expect(applied?.appliedAt).toBeTruthy();

    const [menuRow] = await db.select().from(menus).where(eq(menus.id, menu.id));
    expect(menuRow?.lastUpdatedAt).toBeTruthy();
  });

  it("clears existing variants and modifiers when the import has none", async () => {
    const { admin, menu, category, record } = await setup();

    const existing = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category.id, {
        name: "Family Meal",
        basePrice: null,
        variants: [
          { name: "Small", price: 10000 },
          { name: "Large", price: 15000 },
        ],
        modifiers: [
          { name: "Extra rice", price: 2500, isAvailable: true },
        ],
      }),
    );

    await db.insert(menuImportItems).values({
      importId: record.id,
      categoryName: "Mains",
      name: "Family Meal",
      basePriceMinor: 20000,
      variants: [],
      modifiers: [],
      matchedMenuItemId: existing.id,
      matchedLogicalId: existing.logicalId,
      changeType: "price_changed",
      decision: "accept",
    });

    await applyMenuImport(db, admin.id, record.id);

    const variants = await db
      .select()
      .from(menuItemVariants)
      .where(eq(menuItemVariants.menuItemId, existing.id));
    const modifiers = await db
      .select()
      .from(menuItemModifiers)
      .where(eq(menuItemModifiers.menuItemId, existing.id));
    const [updated] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, existing.id));

    expect(variants).toHaveLength(0);
    expect(modifiers).toHaveLength(0);
    expect(updated?.basePriceMinor).toBe(20000);
  });

  it("refuses to apply an import with no accepted items", async () => {
    const { admin, record } = await setup();

    await db.insert(menuImportItems).values({
      importId: record.id,
      categoryName: "Mains",
      name: "Pending Item",
      basePriceMinor: 5000,
      decision: "pending",
    });

    await expect(
      applyMenuImport(db, admin.id, record.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a price before applying an accepted item", async () => {
    const { admin, record } = await setup();

    await db.insert(menuImportItems).values({
      importId: record.id,
      categoryName: "Mains",
      name: "Unpriced Item",
      basePriceMinor: null,
      decision: "accept",
    });

    await expect(
      applyMenuImport(db, admin.id, record.id),
    ).rejects.toThrow(/has no price/);
  });

  it("requires edit permission to review or apply", async () => {
    const { viewer, record } = await setup();

    const [staged] = await db
      .insert(menuImportItems)
      .values({
        importId: record.id,
        categoryName: "Mains",
        name: "Viewer Edit",
        basePriceMinor: 5000,
        decision: "pending",
      })
      .returning();

    await expect(
      updateImportItem(db, viewer.id, record.id, staged!.id, {
        decision: "accept",
        categoryName: "Mains",
        name: "Viewer Edit",
        basePrice: "50.00",
        availabilityStatus: "available",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      applyMenuImport(db, viewer.id, record.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
