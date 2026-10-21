import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/db/client";
import { menuCategories, menuItems } from "@/db/schema";
import { removeMenuItemImage } from "@/server/services/images";
import { loadMenuTree } from "@/server/services/menu-tree";
import { createMenuItem } from "@/server/services/menu-content";
import { createMenu, publishMenu, startEditingMenu } from "@/server/services/menus";
import { createRestaurant } from "@/server/services/restaurants";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

const storageMock = vi.hoisted(() => ({
  deleteObject: vi.fn(async () => undefined),
  putObject: vi.fn(async () => undefined),
  getPublicUrl: vi.fn(() => null),
  isPublicStorageConfigured: vi.fn(() => true),
  buildObjectKey: vi.fn(
    (prefix: string, extension: string) => `${prefix}/new.${extension}`,
  ),
}));

vi.mock("@/server/services/storage", () => storageMock);

describe("menu item image references (ephemeral PGlite)", () => {
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
    storageMock.deleteObject.mockClear();
  });

  async function setupPublishedMenu() {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Image Test Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Dinner",
    });
    const [category] = await db
      .insert(menuCategories)
      .values({ menuId: menu.id, name: "Mains" })
      .returning();
    const item = await createMenuItem(db, admin.id, menu.id, {
      categoryId: category!.id,
      name: "Shared Image Dish",
      description: null,
      basePrice: 10000,
      availabilityStatus: "available",
      sortOrder: 10,
      variants: [],
      modifiers: [],
    });
    await db
      .update(menuItems)
      .set({ imageObjectKey: "shared.webp" })
      .where(eq(menuItems.id, item.id));

    await publishMenu(db, admin.id, menu.id);
    const draft = await startEditingMenu(db, admin.id, menu.id);
    const draftTree = await loadMenuTree(db, draft.id);
    const draftItem = draftTree?.categories
      .flatMap((entry) => entry.items)
      .find((entry) => entry.logicalId === item.logicalId);

    return { admin, draft, draftItem: draftItem! };
  }

  it("keeps a shared image when it is removed from a cloned draft", async () => {
    const { admin, draft, draftItem } = await setupPublishedMenu();

    await removeMenuItemImage(db, admin.id, draft.id, draftItem.id);

    expect(storageMock.deleteObject).not.toHaveBeenCalled();
    const [updated] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, draftItem.id));
    expect(updated?.imageObjectKey).toBeNull();
  });

  it("deletes an image that has no other references", async () => {
    const { admin, draft, draftItem } = await setupPublishedMenu();
    const draftTree = await loadMenuTree(db, draft.id);
    const categoryId = draftTree!.categories[0]!.id;
    const [unique] = await db
      .insert(menuItems)
      .values({
        categoryId,
        name: "Unique Image Dish",
        basePriceMinor: 5000,
        imageObjectKey: "unique.webp",
        sortOrder: 20,
      })
      .returning();

    await removeMenuItemImage(db, admin.id, draft.id, unique!.id);

    expect(storageMock.deleteObject).toHaveBeenCalledWith("unique.webp");
    expect(storageMock.deleteObject).not.toHaveBeenCalledWith("shared.webp");
    expect(draftItem.imageObjectKey).toBe("shared.webp");
  });
});
