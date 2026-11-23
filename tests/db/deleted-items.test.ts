import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
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

  it("lists deleted menus and soft-deleted scans for admins", async () => {
    const { admin, restaurant, menu, importRecord } = await setup();

    await deleteMenu(db, admin.id, menu.id);
    await softDeleteMenuImport(db, admin.id, importRecord.id);

    const data = await listDeletedItems(db, admin.id, restaurant.id);

    expect(data.retentionDays).toBe(30);
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
