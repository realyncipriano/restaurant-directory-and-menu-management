import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  menuCategories,
  menuChangeLogs,
  menuImportItems,
  menuImportPages,
  menuImports,
  menuItems,
  menus,
} from "@/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import type { ItemInput } from "@/lib/validation/menu";
import {
  getMenuImport,
  listMenuImports,
  purgeExpiredMenuImports,
  softDeleteMenuImport,
} from "@/server/services/imports";
import {
  getAppSettings,
  updateScanRetention,
} from "@/server/services/app-settings";
import { createMenuItem } from "@/server/services/menu-content";
import { createMenu } from "@/server/services/menus";
import {
  createRestaurant,
  setRestaurantPermission,
} from "@/server/services/restaurants";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

const DAY_MS = 24 * 60 * 60 * 1000;

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

describe("menu import deletion and purge (ephemeral PGlite)", () => {
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

  async function setup(
    options: { status?: typeof menuImports.$inferInsert.status } = {},
  ) {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const viewer = await seedUser(db, { email: "viewer@example.com" });
    const editor = await seedUser(db, { email: "editor@example.com" });

    const restaurant = await createRestaurant(db, admin.id, {
      name: "Scan Deletion Kitchen",
    });
    await setRestaurantPermission(db, admin.id, restaurant.id, viewer.id, {});
    await setRestaurantPermission(db, admin.id, restaurant.id, editor.id, {
      canEditMenu: true,
    });

    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const [category] = await db
      .insert(menuCategories)
      .values({ menuId: menu.id, name: "Mains" })
      .returning();
    const item = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category!.id),
    );

    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: options.status ?? "needs_review",
      })
      .returning();

    await db.insert(menuImportPages).values({
      importId: record!.id,
      pageNumber: 1,
      privateSourceObjectKey: `imports/${record!.id}/page-1.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    });
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Scanned Dish",
      basePriceMinor: 5000,
    });

    return {
      admin,
      viewer,
      editor,
      restaurant,
      menu,
      category: category!,
      item,
      record: record!,
    };
  }

  it("soft-deletes a scan and preserves menu content", async () => {
    const { admin, restaurant, menu, item, record } = await setup();

    await softDeleteMenuImport(db, admin.id, record.id);

    const [deleted] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record.id));
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(deleted?.deletedBy).toBe(admin.id);

    const listed = await listMenuImports(db, admin.id, restaurant.id);
    expect(listed.imports).toHaveLength(0);
    expect(listed.retentionDays).toBe(30);

    await expect(
      getMenuImport(db, admin.id, record.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(
      await db.select().from(menus).where(eq(menus.id, menu.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(menuItems).where(eq(menuItems.id, item.id)),
    ).toHaveLength(1);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "import_deleted"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({
      restaurantId: restaurant.id,
      menuId: menu.id,
      status: "needs_review",
    });
  });

  it("allows applied scans to be deleted without changing applied menu data", async () => {
    const { admin, menu, item, record } = await setup({ status: "applied" });
    await db
      .update(menuImports)
      .set({ appliedAt: new Date() })
      .where(eq(menuImports.id, record.id));

    await softDeleteMenuImport(db, admin.id, record.id);

    const [menuRow] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menu.id));
    expect(menuRow?.status).toBe("draft");

    const [itemRow] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, item.id));
    expect(itemRow?.name).toBe("Chicken Adobo");
  });

  it("requires menu edit permission and is idempotent", async () => {
    const { viewer, editor, record } = await setup();

    await expect(
      softDeleteMenuImport(db, viewer.id, record.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await softDeleteMenuImport(db, editor.id, record.id);
    await softDeleteMenuImport(db, editor.id, record.id);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "import_deleted"));
    expect(audits).toHaveLength(1);
  });

  it("rejects deleting a scan that is still processing", async () => {
    const { admin, record } = await setup({ status: "processing" });

    await expect(
      softDeleteMenuImport(db, admin.id, record.id),
    ).rejects.toBeInstanceOf(ConflictError);

    const [row] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record.id));
    expect(row?.deletedAt).toBeNull();
  });

  it("purges only scans whose retention period has ended", async () => {
    const { admin, restaurant, menu, item, record } = await setup();
    const now = new Date("2026-02-01T00:00:00Z");

    await db
      .update(menuImports)
      .set({
        deletedAt: new Date(now.getTime() - 31 * DAY_MS),
        deletedBy: admin.id,
      })
      .where(eq(menuImports.id, record.id));

    const [recent] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "failed",
      })
      .returning();
    await db
      .update(menuImports)
      .set({ deletedAt: new Date(now.getTime() - 5 * DAY_MS) })
      .where(eq(menuImports.id, recent!.id));

    await db.insert(menuChangeLogs).values({
      restaurantId: restaurant.id,
      menuId: menu.id,
      action: "import_applied",
      importId: record.id,
    });

    const result = await purgeExpiredMenuImports(db, {
      now,
      retentionDays: 30,
    });
    expect(result).toMatchObject({ purged: 1, retentionDays: 30 });

    expect(
      await db.select().from(menuImports).where(eq(menuImports.id, record.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(menuImportPages)
        .where(eq(menuImportPages.importId, record.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(menuImportItems)
        .where(eq(menuImportItems.importId, record.id)),
    ).toHaveLength(0);

    expect(
      await db
        .select()
        .from(menuImports)
        .where(eq(menuImports.id, recent!.id)),
    ).toHaveLength(1);

    expect(
      await db.select().from(menus).where(eq(menus.id, menu.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(menuItems).where(eq(menuItems.id, item.id)),
    ).toHaveLength(1);

    const [change] = await db
      .select()
      .from(menuChangeLogs)
      .where(eq(menuChangeLogs.menuId, menu.id));
    expect(change?.importId).toBeNull();

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "import_purged"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityId).toBe(record.id);
    expect(audits[0]?.details).toMatchObject({
      restaurantId: restaurant.id,
      menuId: menu.id,
      sourceObjects: 1,
      retentionDays: 30,
    });
  });

  it("uses the admin-configured retention period", async () => {
    const { admin, record } = await setup();
    const now = new Date("2026-02-01T00:00:00Z");

    expect((await updateScanRetention(db, admin.id, 1))).toBe(1);
    expect((await getAppSettings(db)).scanRetentionDays).toBe(1);

    await db
      .update(menuImports)
      .set({ deletedAt: new Date(now.getTime() - 2 * DAY_MS) })
      .where(eq(menuImports.id, record.id));

    const result = await purgeExpiredMenuImports(db, { now });
    expect(result.purged).toBe(1);

    expect(
      await db.select().from(menuImports).where(eq(menuImports.id, record.id)),
    ).toHaveLength(0);
  });

  it("purges expired scans when the scan history is loaded", async () => {
    const { admin, restaurant, record } = await setup();

    await db
      .update(menuImports)
      .set({ deletedAt: new Date(Date.now() - 31 * DAY_MS) })
      .where(eq(menuImports.id, record.id));

    const listed = await listMenuImports(db, admin.id, restaurant.id);
    expect(listed.imports).toHaveLength(0);

    expect(
      await db.select().from(menuImports).where(eq(menuImports.id, record.id)),
    ).toHaveLength(0);
  });
});
