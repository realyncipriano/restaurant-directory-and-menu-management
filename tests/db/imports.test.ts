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
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { ItemInput } from "@/lib/validation/menu";
import {
  applyMenuImport,
  keepOnlyImportCategory,
  updateImportCategoryDecision,
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

  async function stageItem(
    importId: string,
    values: Partial<typeof menuImportItems.$inferInsert> & {
      categoryName: string;
      name: string;
    },
  ) {
    const [row] = await db
      .insert(menuImportItems)
      .values({
        importId,
        basePriceMinor: 5000,
        currency: "PHP",
        confidence: 90,
        needsReview: false,
        changeType: "new",
        decision: "pending",
        ...values,
      })
      .returning();
    return row!;
  }

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

  it("keeps only the selected category and applies only its items", async () => {
    const { admin, menu, record } = await setup();

    await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Latte",
      basePriceMinor: 12000,
    });
    await stageItem(record.id, {
      categoryName: "Non-coffee",
      name: "Matcha",
      basePriceMinor: 15000,
    });
    await stageItem(record.id, {
      categoryName: "Espresso Specials",
      name: "Espresso",
      basePriceMinor: 9000,
    });

    const result = await keepOnlyImportCategory(
      db,
      admin.id,
      record.id,
      "non-coffee",
    );

    expect(result).toMatchObject({
      categoryName: "Non-coffee",
      accepted: 1,
      rejected: 2,
      pending: 0,
      pendingInCategory: 0,
    });

    await applyMenuImport(db, admin.id, record.id);

    const categories = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.menuId, menu.id));
    const categoryNames = categories.map((category) => category.name);
    expect(categoryNames).toContain("Non-coffee");
    expect(categoryNames).not.toContain("Coffee");
    expect(categoryNames).not.toContain("Espresso Specials");

    const matcha = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Matcha"));
    const latte = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Latte"));
    const espresso = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Espresso"));
    expect(matcha).toHaveLength(1);
    expect(latte).toHaveLength(0);
    expect(espresso).toHaveLength(0);
  });

  it("rejects previously accepted items outside the kept category", async () => {
    const { admin, record } = await setup();

    const coffee = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "House Blend",
      basePriceMinor: 11000,
      decision: "accept",
    });
    const nonCoffee = await stageItem(record.id, {
      categoryName: "Non-coffee",
      name: "Iced Tea",
      basePriceMinor: 8000,
      decision: "accept",
    });

    const result = await keepOnlyImportCategory(
      db,
      admin.id,
      record.id,
      "Non-coffee",
    );

    expect(result).toMatchObject({
      accepted: 0,
      rejected: 1,
      pending: 0,
      pendingInCategory: 0,
    });

    const rows = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, record.id));
    const byId = new Map(rows.map((row) => [row.id, row.decision]));
    expect(byId.get(coffee.id)).toBe("reject");
    expect(byId.get(nonCoffee.id)).toBe("accept");

    await applyMenuImport(db, admin.id, record.id);
    const coffeeItem = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "House Blend"));
    expect(coffeeItem).toHaveLength(0);
  });

  it("keeps flagged, low-confidence, and unpriced items pending on keep only", async () => {
    const { admin, record } = await setup();

    const lowConfidence = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Low Confidence",
      confidence: 60,
      needsReview: true,
    });
    const unpriced = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "No Price",
      basePriceMinor: null,
      variants: [],
      needsReview: true,
    });
    const flagged = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Flagged Change",
      needsReview: true,
    });
    const normal = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Ordinary Coffee",
    });
    const kept = await stageItem(record.id, {
      categoryName: "Non-coffee",
      name: "Matcha",
    });

    const result = await keepOnlyImportCategory(
      db,
      admin.id,
      record.id,
      "Non-coffee",
    );

    expect(result).toMatchObject({
      accepted: 1,
      rejected: 1,
      pending: 3,
      pendingInCategory: 0,
    });

    const rows = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, record.id));
    const byId = new Map(rows.map((row) => [row.id, row.decision]));
    expect(byId.get(lowConfidence.id)).toBe("pending");
    expect(byId.get(unpriced.id)).toBe("pending");
    expect(byId.get(flagged.id)).toBe("pending");
    expect(byId.get(normal.id)).toBe("reject");
    expect(byId.get(kept.id)).toBe("accept");
  });

  it("updates only the intended category for accept and reject decisions", async () => {
    const { admin, record } = await setup();

    const coffeeOne = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Americano",
    });
    const coffeeTwo = await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Cappuccino",
    });
    const nonCoffee = await stageItem(record.id, {
      categoryName: "Non-coffee",
      name: "Fruit Tea",
    });

    const accepted = await updateImportCategoryDecision(
      db,
      admin.id,
      record.id,
      "  NON-COFFEE ",
      "accept",
    );
    expect(accepted).toMatchObject({
      categoryName: "Non-coffee",
      accepted: 1,
      rejected: 0,
      pending: 2,
      pendingInCategory: 0,
    });

    const rejected = await updateImportCategoryDecision(
      db,
      admin.id,
      record.id,
      "coffee",
      "reject",
    );
    expect(rejected).toMatchObject({
      accepted: 0,
      rejected: 2,
      pending: 0,
      pendingInCategory: 0,
    });

    const repeatedAccept = await updateImportCategoryDecision(
      db,
      admin.id,
      record.id,
      "Non-coffee",
      "accept",
    );
    expect(repeatedAccept.accepted).toBe(0);

    const repeatedReject = await updateImportCategoryDecision(
      db,
      admin.id,
      record.id,
      "Coffee",
      "reject",
    );
    expect(repeatedReject.rejected).toBe(0);

    const rows = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, record.id));
    const byId = new Map(rows.map((row) => [row.id, row.decision]));
    expect(byId.get(coffeeOne.id)).toBe("reject");
    expect(byId.get(coffeeTwo.id)).toBe("reject");
    expect(byId.get(nonCoffee.id)).toBe("accept");
  });

  it("matches categories case-insensitively and rejects blank or unknown categories", async () => {
    const { admin, record } = await setup();
    await stageItem(record.id, {
      categoryName: "Non-coffee",
      name: "Matcha",
    });

    await expect(
      keepOnlyImportCategory(db, admin.id, record.id, "   "),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateImportCategoryDecision(db, admin.id, record.id, "", "accept"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      keepOnlyImportCategory(db, admin.id, record.id, "Tea"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateImportCategoryDecision(
        db,
        admin.id,
        record.id,
        "Tea",
        "reject",
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const rows = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, record.id));
    expect(rows.every((row) => row.decision === "pending")).toBe(true);
  });

  it("rejects category decisions from read-only and unauthorized users", async () => {
    const { admin, viewer, record } = await setup();
    const outsider = await seedUser(db, {
      email: "outsider@example.com",
    });
    await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Latte",
    });

    await expect(
      updateImportCategoryDecision(
        db,
        viewer.id,
        record.id,
        "Coffee",
        "accept",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      keepOnlyImportCategory(db, viewer.id, record.id, "Coffee"),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      updateImportCategoryDecision(
        db,
        outsider.id,
        record.id,
        "Coffee",
        "accept",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      keepOnlyImportCategory(db, outsider.id, record.id, "Coffee"),
    ).rejects.toBeInstanceOf(NotFoundError);

    const accepted = await updateImportCategoryDecision(
      db,
      admin.id,
      record.id,
      "Coffee",
      "accept",
    );
    expect(accepted.accepted).toBe(1);
  });

  it("keeps decisions stable across repeated and concurrent keep only requests", async () => {
    const { admin, record } = await setup();
    await stageItem(record.id, {
      categoryName: "Coffee",
      name: "Americano",
    });
    await stageItem(record.id, {
      categoryName: "Non-coffee",
      name: "Matcha",
    });

    const results = await Promise.allSettled([
      keepOnlyImportCategory(db, admin.id, record.id, "Non-coffee"),
      keepOnlyImportCategory(db, admin.id, record.id, "Non-coffee"),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const rows = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, record.id));
    const byCategory = new Map(
      rows.map((row) => [row.categoryName, row.decision]),
    );
    expect(byCategory.get("Coffee")).toBe("reject");
    expect(byCategory.get("Non-coffee")).toBe("accept");
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
