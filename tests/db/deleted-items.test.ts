import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  menuImportItems,
  menuImportPages,
  menuImports,
  menus,
} from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  getDeletedMenuImport,
  listDeletedItems,
} from "@/server/services/deleted-items";
import { softDeleteMenuImport } from "@/server/services/imports";
import { createMenu, deleteMenu, discardDraft } from "@/server/services/menus";
import {
  createRestaurant,
  setRestaurantPermission,
} from "@/server/services/restaurants";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

describe("deleted items admin view (ephemeral PGlite)", () => {
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
    const editor = await seedUser(db, { email: "editor@example.com" });

    const restaurant = await createRestaurant(db, admin.id, {
      name: "Deleted Items Kitchen",
    });
    await setRestaurantPermission(db, admin.id, restaurant.id, editor.id, {
      canEditMenu: true,
    });

    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });

    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();

    await db.insert(menuImportPages).values({
      importId: record!.id,
      pageNumber: 1,
      privateSourceObjectKey: "imports/test-page.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      processingStatus: "processed",
    });

    await db.insert(menuImportItems).values({
      importId: record!.id,
      pageNumber: 1,
      categoryName: "Mains",
      name: "Chicken Adobo",
      description: "Braised chicken",
      basePriceMinor: 18500,
    });

    return { admin, editor, restaurant, menu, importRecord: record! };
  }

  async function seedDeletedScans(
    ctx: Awaited<ReturnType<typeof setup>>,
    count: number,
  ) {
    const base = Date.now() - 60 * 60 * 1000;
    const rows = await db
      .insert(menuImports)
      .values(
        Array.from({ length: count }, (_, index) => ({
          restaurantId: ctx.restaurant.id,
          menuId: ctx.menu.id,
          uploadedBy: ctx.admin.id,
          status: "needs_review" as const,
          deletedAt: new Date(base - index * 60_000),
          deletedBy: ctx.admin.id,
        })),
      )
      .returning({ id: menuImports.id, deletedAt: menuImports.deletedAt });

    return rows.sort(
      (left, right) =>
        right.deletedAt!.getTime() - left.deletedAt!.getTime() ||
        right.id.localeCompare(left.id),
    );
  }

  async function seedDeletedMenus(
    ctx: Awaited<ReturnType<typeof setup>>,
    count: number,
  ) {
    const base = Date.now() - 60 * 60 * 1000;
    const rows = await db
      .insert(menus)
      .values(
        Array.from({ length: count }, (_, index) => ({
          restaurantId: ctx.restaurant.id,
          title: `Deleted menu ${index + 1}`,
          slug: `deleted-menu-${index + 1}`,
          status: "archived" as const,
          version: 1,
          createdBy: ctx.admin.id,
        })),
      )
      .returning({
        id: menus.id,
        lineageId: menus.lineageId,
        title: menus.title,
        slug: menus.slug,
      });

    await db.insert(auditLogs).values(
      rows.map((row, index) => ({
        actorId: ctx.admin.id,
        actorEmail: ctx.admin.email,
        action: "menu_deleted",
        entityType: "menu",
        entityId: row.id,
        createdAt: new Date(base - index * 60_000),
        details: { hadPublished: false },
      })),
    );

    return rows
      .map((row, index) => ({
        ...row,
        deletedAt: new Date(base - index * 60_000),
      }))
      .sort(
        (left, right) =>
          right.deletedAt.getTime() - left.deletedAt.getTime() ||
          right.id.localeCompare(left.id),
      );
  }

  it("lists deleted menus and soft-deleted scans for admins", async () => {
    const { admin, restaurant, menu, importRecord } = await setup();

    await deleteMenu(db, admin.id, menu.id);
    await softDeleteMenuImport(db, admin.id, importRecord.id);

    const data = await listDeletedItems(db, admin.id, restaurant.id);

    expect(data.retentionDays).toBe(30);
    expect(data.menuTotal).toBe(1);
    expect(data.menuPage).toBe(1);
    expect(data.menuPageCount).toBe(1);
    expect(data.menuPageSize).toBe(15);
    expect(data.menus).toHaveLength(1);
    expect(data.menus[0]).toMatchObject({
      lineageId: menu.lineageId,
      menuId: menu.id,
      title: "Lunch",
      slug: menu.slug,
      versionCount: 1,
      hadPublished: false,
    });
    expect(data.menus[0]?.deletedAt).toBeInstanceOf(Date);

    expect(data.scans).toHaveLength(1);
    expect(data.scans[0]).toMatchObject({
      id: importRecord.id,
      menuId: menu.id,
      menuTitle: "Lunch",
      menuStatus: "archived",
      status: "needs_review",
      pageCount: 1,
      itemCount: 1,
    });
    expect(data.scans[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it("paginates deleted scans 15 at a time, newest first", async () => {
    const ctx = await setup();
    const seeded = await seedDeletedScans(ctx, 17);

    const firstPage = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
    );

    expect(firstPage.scanTotal).toBe(17);
    expect(firstPage.scanPage).toBe(1);
    expect(firstPage.scanPageCount).toBe(2);
    expect(firstPage.scanPageSize).toBe(15);
    expect(firstPage.scans).toHaveLength(15);
    expect(firstPage.scans.map((scan) => scan.id)).toEqual(
      seeded.slice(0, 15).map((scan) => scan.id),
    );

    const secondPage = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
      { page: 2 },
    );

    expect(secondPage.scanTotal).toBe(17);
    expect(secondPage.scanPage).toBe(2);
    expect(secondPage.scanPageCount).toBe(2);
    expect(secondPage.scans).toHaveLength(2);
    expect(secondPage.scans.map((scan) => scan.id)).toEqual(
      seeded.slice(15).map((scan) => scan.id),
    );

    const seen = new Set(
      [...firstPage.scans, ...secondPage.scans].map((scan) => scan.id),
    );
    expect(seen.size).toBe(17);
  });

  it("clamps out-of-range scan pages", async () => {
    const ctx = await setup();
    const seeded = await seedDeletedScans(ctx, 17);

    const zero = await listDeletedItems(db, ctx.admin.id, ctx.restaurant.id, {
      page: 0,
    });
    expect(zero.scanPage).toBe(1);
    expect(zero.scans[0]?.id).toBe(seeded[0]?.id);

    const negative = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
      { page: -4 },
    );
    expect(negative.scanPage).toBe(1);
    expect(negative.scans).toHaveLength(15);

    const tooHigh = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
      { page: 99 },
    );
    expect(tooHigh.scanPage).toBe(2);
    expect(tooHigh.scans).toHaveLength(2);
    expect(tooHigh.scans[1]?.id).toBe(seeded[16]?.id);
  });

  it("paginates deleted menus 15 at a time, newest first", async () => {
    const ctx = await setup();
    const seeded = await seedDeletedMenus(ctx, 17);

    const firstPage = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
    );

    expect(firstPage.menuTotal).toBe(17);
    expect(firstPage.menuPage).toBe(1);
    expect(firstPage.menuPageCount).toBe(2);
    expect(firstPage.menuPageSize).toBe(15);
    expect(firstPage.menus).toHaveLength(15);
    expect(firstPage.menus.map((menu) => menu.menuId)).toEqual(
      seeded.slice(0, 15).map((menu) => menu.id),
    );

    const secondPage = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
      { page: 2 },
    );

    expect(secondPage.menuTotal).toBe(17);
    expect(secondPage.menuPage).toBe(2);
    expect(secondPage.menuPageCount).toBe(2);
    expect(secondPage.menus).toHaveLength(2);
    expect(secondPage.menus.map((menu) => menu.menuId)).toEqual(
      seeded.slice(15).map((menu) => menu.id),
    );

    const seen = new Set(
      [...firstPage.menus, ...secondPage.menus].map((menu) => menu.menuId),
    );
    expect(seen.size).toBe(17);
  });

  it("clamps out-of-range menu pages", async () => {
    const ctx = await setup();
    const seeded = await seedDeletedMenus(ctx, 17);

    const zero = await listDeletedItems(db, ctx.admin.id, ctx.restaurant.id, {
      page: 0,
    });
    expect(zero.menuPage).toBe(1);
    expect(zero.menus[0]?.menuId).toBe(seeded[0]?.id);

    const negative = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
      { page: -4 },
    );
    expect(negative.menuPage).toBe(1);
    expect(negative.menus).toHaveLength(15);

    const tooHigh = await listDeletedItems(
      db,
      ctx.admin.id,
      ctx.restaurant.id,
      { page: 99 },
    );
    expect(tooHigh.menuPage).toBe(2);
    expect(tooHigh.menus).toHaveLength(2);
    expect(tooHigh.menus[1]?.menuId).toBe(seeded[16]?.id);
  });

  it("reports an empty scan page when nothing was deleted", async () => {
    const ctx = await setup();

    const data = await listDeletedItems(db, ctx.admin.id, ctx.restaurant.id);

    expect(data.scanTotal).toBe(0);
    expect(data.scanPage).toBe(1);
    expect(data.scanPageCount).toBe(1);
    expect(data.scans).toEqual([]);
    expect(data.menuTotal).toBe(0);
    expect(data.menuPage).toBe(1);
    expect(data.menuPageCount).toBe(1);
    expect(data.menuPageSize).toBe(15);
    expect(data.menus).toEqual([]);
  });

  it("does not list archived drafts that were discarded", async () => {
    const { admin, restaurant, menu } = await setup();

    await discardDraft(db, admin.id, menu.id);

    const data = await listDeletedItems(db, admin.id, restaurant.id);

    expect(data.menus).toHaveLength(0);
  });

  it("returns a read-only deleted scan with pages and items", async () => {
    const { admin, restaurant, importRecord } = await setup();
    await softDeleteMenuImport(db, admin.id, importRecord.id);

    const data = await getDeletedMenuImport(db, admin.id, importRecord.id);

    expect(data.import.restaurantId).toBe(restaurant.id);
    expect(data.import.deletedAt).toBeInstanceOf(Date);
    expect(data.pages).toHaveLength(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.name).toBe("Chicken Adobo");
  });

  it("only exposes scans that were soft-deleted", async () => {
    const { admin, importRecord } = await setup();

    await expect(
      getDeletedMenuImport(db, admin.id, importRecord.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects non-admin access", async () => {
    const { editor, restaurant } = await setup();

    await expect(
      listDeletedItems(db, editor.id, restaurant.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps archived menu content available after deletion", async () => {
    const { admin, menu } = await setup();

    await deleteMenu(db, admin.id, menu.id);

    const [row] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menu.id))
      .limit(1);

    expect(row?.status).toBe("archived");
  });
});
