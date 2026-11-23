import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  menuCategories,
  menuChangeLogs,
  menuItemModifiers,
  menuItems,
  menuItemVariants,
  menus,
} from "@/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  createMenu,
  deleteMenu,
  discardDraft,
  getMenuManagement,
  listMenusForRestaurant,
  publishMenu,
  startEditingMenu,
  updateMenuSettings,
} from "@/server/services/menus";
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  updateMenuItem,
} from "@/server/services/menu-content";
import {
  createRestaurant,
  setRestaurantArchived,
  setRestaurantPermission,
} from "@/server/services/restaurants";
import { getPublicMenu } from "@/server/services/public-directory";
import type { ItemInput } from "@/lib/validation/menu";
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

describe("menu services (ephemeral PGlite)", () => {
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
    const publisher = await seedUser(db, {
      email: "publisher@example.com",
    });
    const viewer = await seedUser(db, { email: "viewer@example.com" });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Menu Test Kitchen",
    });

    await setRestaurantPermission(
      db,
      admin.id,
      restaurant.id,
      editor.id,
      { canEditMenu: true },
    );
    await setRestaurantPermission(
      db,
      admin.id,
      restaurant.id,
      publisher.id,
      { canPublishMenu: true },
    );
    await setRestaurantPermission(
      db,
      admin.id,
      restaurant.id,
      viewer.id,
      {},
    );

    return { admin, editor, publisher, viewer, restaurant };
  }

  async function menuDeletedAudits(lineageId: string) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "menu_deleted"));
    return rows.filter((row) => row.details?.lineageId === lineageId);
  }

  it("creates draft menus with generated, unique slugs", async () => {
    const { admin, editor, restaurant } = await setup();

    const first = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch Menu",
    });
    expect(first.status).toBe("draft");
    expect(first.version).toBe(1);
    expect(first.slug).toBe("lunch-menu");
    expect(first.lineageId).toBe(first.id);

    const second = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch Menu",
    });
    expect(second.slug).toBe("lunch-menu-2");

    const memberMenu = await createMenu(db, editor.id, restaurant.id, {
      title: "Dinner",
    });
    expect(memberMenu.slug).toBe("dinner");

    await expect(
      createMenu(db, admin.id, restaurant.id, {
        title: "Conflict",
        slug: "lunch-menu",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("adds categories and priced items, rejecting duplicate categories", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });

    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
      sortOrder: 10,
    });
    expect(category.name).toBe("Mains");

    await expect(
      createCategory(db, admin.id, menu.id, { name: "mains" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const item = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category.id, {
        variants: [
          { name: "Regular", price: 18500 },
          { name: "Large", price: 22500 },
        ],
        modifiers: [
          { name: "Extra rice", price: 2500, isAvailable: true },
        ],
      }),
    );

    expect(item.basePriceMinor).toBe(18500);
    expect(item.currency).toBe("PHP");
    expect(item.logicalId).toBeTruthy();
  });

  it("blocks publishing empty or unpriced drafts", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Empty",
    });

    await expect(
      publishMenu(db, admin.id, menu.id),
    ).rejects.toBeInstanceOf(ValidationError);

    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await expect(
      publishMenu(db, admin.id, menu.id),
    ).rejects.toBeInstanceOf(ValidationError);

    await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category.id, { basePrice: null }),
    );
    await expect(
      publishMenu(db, admin.id, menu.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("publishes, versions, and records price changes on a cloned draft", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    const item = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category.id),
    );

    const published = await publishMenu(db, admin.id, menu.id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    const initialLogs = await db
      .select()
      .from(menuChangeLogs)
      .where(
        and(
          eq(menuChangeLogs.menuId, menu.id),
          eq(menuChangeLogs.action, "item_created"),
        ),
      );
    expect(initialLogs).toHaveLength(1);

    await expect(
      updateMenuSettings(db, admin.id, menu.id, { title: "Nope" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const draft = await startEditingMenu(db, admin.id, menu.id);
    expect(draft.status).toBe("draft");
    expect(draft.version).toBe(2);
    expect(draft.lineageId).toBe(menu.lineageId);

    const again = await startEditingMenu(db, admin.id, menu.id);
    expect(again.id).toBe(draft.id);

    const clonedItem = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.logicalId, item.logicalId));
    const draftItem = clonedItem.find((row) => row.id !== item.id);
    expect(draftItem).toBeTruthy();

    const draftCategory = await db
      .select()
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.menuId, draft.id),
          eq(menuCategories.name, "Mains"),
        ),
      );
    expect(draftCategory).toHaveLength(1);

    await updateMenuItem(
      db,
      admin.id,
      draft.id,
      draftItem!.id,
      itemInput(draftCategory[0]!.id, { basePrice: 20500 }),
    );

    const republished = await publishMenu(db, admin.id, draft.id);
    expect(republished.status).toBe("published");
    expect(republished.version).toBe(2);

    const oldVersion = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menu.id));
    expect(oldVersion[0]?.status).toBe("archived");

    const priceLogs = await db
      .select()
      .from(menuChangeLogs)
      .where(
        and(
          eq(menuChangeLogs.menuId, draft.id),
          eq(menuChangeLogs.action, "price_changed"),
        ),
      );
    expect(priceLogs).toHaveLength(1);
    expect(priceLogs[0]?.menuItemLogicalId).toBe(item.logicalId);
    expect(priceLogs[0]?.previousValues).toMatchObject({
      basePriceMinor: 18500,
    });
    expect(priceLogs[0]?.newValues).toMatchObject({
      basePriceMinor: 20500,
    });

    const summaries = await listMenusForRestaurant(
      db,
      admin.id,
      restaurant.id,
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.published?.version).toBe(2);
    expect(summaries[0]?.draft).toBeNull();

    const management = await getMenuManagement(db, admin.id, draft.id);
    expect(management.versions).toHaveLength(2);
  });

  it("validates normalized item input inside the service layer", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });

    await expect(
      createMenuItem(
        db,
        admin.id,
        menu.id,
        itemInput(category.id, { name: "   " }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createMenuItem(
        db,
        admin.id,
        menu.id,
        itemInput(category.id, { basePrice: -1 }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const created = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category.id),
    );
    await expect(
      updateMenuItem(
        db,
        admin.id,
        menu.id,
        created.id,
        itemInput(category.id, {
          variants: [
            { name: "Small", price: 1000 },
            { name: "small", price: 2000 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces edit, publish, and view permissions", async () => {
    const { admin, editor, publisher, viewer, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, itemInput(category.id));

    await expect(
      publishMenu(db, editor.id, menu.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCategory(db, publisher.id, menu.id, { name: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const visible = await listMenusForRestaurant(
      db,
      viewer.id,
      restaurant.id,
    );
    expect(visible).toHaveLength(1);
    await expect(
      publishMenu(db, viewer.id, menu.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const outsider = await seedUser(db, { email: "outsider@example.com" });
    await expect(
      listMenusForRestaurant(db, outsider.id, restaurant.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    const published = await publishMenu(db, publisher.id, menu.id);
    expect(published.status).toBe("published");
  });

  it("scopes menus to the restaurant access grant", async () => {
    const { admin, editor, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const otherRestaurant = await createRestaurant(db, admin.id, {
      name: "Other",
    });

    await expect(
      getMenuManagement(db, editor.id, menu.id),
    ).resolves.toBeTruthy();
    await expect(
      listMenusForRestaurant(db, editor.id, otherRestaurant.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("discards drafts without touching published versions", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, itemInput(category.id));
    await publishMenu(db, admin.id, menu.id);

    const draft = await startEditingMenu(db, admin.id, menu.id);
    await discardDraft(db, admin.id, draft.id);

    const rows = await db.select().from(menus).where(eq(menus.id, draft.id));
    expect(rows[0]?.status).toBe("archived");

    const live = await db.select().from(menus).where(eq(menus.id, menu.id));
    expect(live[0]?.status).toBe("published");

    const summaries = await listMenusForRestaurant(
      db,
      admin.id,
      restaurant.id,
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.draft).toBeNull();
  });

  it("deletes categories and their items from a draft", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, itemInput(category.id));

    await deleteCategory(db, admin.id, menu.id, category.id);

    const remainingItems = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.categoryId, category.id));
    expect(remainingItems).toHaveLength(0);
  });

  it("soft-deletes a draft-only lineage and preserves its content", async () => {
    const { admin, editor, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Draft Delete",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    const item = await createMenuItem(
      db,
      admin.id,
      menu.id,
      itemInput(category.id, {
        variants: [{ name: "Regular", price: 18500 }],
        modifiers: [
          { name: "Extra rice", price: 2500, isAvailable: true },
        ],
      }),
    );
    await db
      .update(menuItems)
      .set({ imageObjectKey: "restaurants/test/items/adobo.jpg" })
      .where(eq(menuItems.id, item.id));

    const deleted = await deleteMenu(db, editor.id, menu.id);
    expect(deleted.status).toBe("archived");

    const rows = await db
      .select()
      .from(menus)
      .where(eq(menus.lineageId, menu.lineageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("archived");

    const management = await getMenuManagement(db, admin.id, menu.id);
    expect(management.isDeleted).toBe(true);
    expect(management.deletion?.entityId).toBe(menu.id);

    const audits = await menuDeletedAudits(menu.lineageId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({
      lineageId: menu.lineageId,
      restaurantId: restaurant.id,
      hadPublished: false,
      versions: 1,
    });

    expect(
      await listMenusForRestaurant(db, admin.id, restaurant.id),
    ).toHaveLength(0);
    await expect(
      startEditingMenu(db, editor.id, menu.id),
    ).rejects.toBeInstanceOf(ConflictError);

    const categories = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.menuId, menu.id));
    expect(categories).toHaveLength(1);

    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.categoryId, category.id));
    expect(items.map((row) => row.id)).toContain(item.id);
    expect(items[0]?.imageObjectKey).toBe(
      "restaurants/test/items/adobo.jpg",
    );

    const priorAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, menu.id));
    expect(priorAudits.some((row) => row.action === "menu_created")).toBe(
      true,
    );

    const variants = await db
      .select()
      .from(menuItemVariants)
      .where(eq(menuItemVariants.menuItemId, item.id));
    expect(variants).toHaveLength(1);

    const modifiers = await db
      .select()
      .from(menuItemModifiers)
      .where(eq(menuItemModifiers.menuItemId, item.id));
    expect(modifiers).toHaveLength(1);
  });

  it("does not label discarded draft-only lineages as deleted", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Discarded Draft",
    });

    await discardDraft(db, admin.id, menu.id);

    const management = await getMenuManagement(db, admin.id, menu.id);
    expect(management.menu.status).toBe("archived");
    expect(management.isDeleted).toBe(false);
    expect(management.deletion).toBeNull();
    expect(await menuDeletedAudits(menu.lineageId)).toHaveLength(0);
  });

  it("marks an explicitly deleted discarded lineage as deleted", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Explicitly Deleted",
    });

    await discardDraft(db, admin.id, menu.id);
    expect(
      (await getMenuManagement(db, admin.id, menu.id)).isDeleted,
    ).toBe(false);

    await deleteMenu(db, admin.id, menu.id);

    expect(
      (await getMenuManagement(db, admin.id, menu.id)).isDeleted,
    ).toBe(true);
    expect(await menuDeletedAudits(menu.lineageId)).toHaveLength(1);
  });

  it("requires edit and publish permission to delete a published lineage", async () => {
    const { admin, editor, publisher, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Live Menu",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, itemInput(category.id));
    await publishMenu(db, admin.id, menu.id);
    const draft = await startEditingMenu(db, admin.id, menu.id);

    await expect(
      deleteMenu(db, editor.id, menu.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      deleteMenu(db, publisher.id, menu.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const before = await db
      .select()
      .from(menus)
      .where(eq(menus.lineageId, menu.lineageId));
    expect(before.some((row) => row.status === "published")).toBe(true);
    expect(before.some((row) => row.status === "draft")).toBe(true);
    expect(await menuDeletedAudits(menu.lineageId)).toHaveLength(0);

    const changeLogsBefore = await db
      .select()
      .from(menuChangeLogs)
      .where(eq(menuChangeLogs.menuId, menu.id));
    expect(changeLogsBefore.length).toBeGreaterThan(0);

    await deleteMenu(db, admin.id, draft.id);

    const after = await db
      .select()
      .from(menus)
      .where(eq(menus.lineageId, menu.lineageId));
    expect(after).toHaveLength(2);
    expect(after.every((row) => row.status === "archived")).toBe(true);

    const changeLogsAfter = await db
      .select()
      .from(menuChangeLogs)
      .where(eq(menuChangeLogs.menuId, menu.id));
    expect(changeLogsAfter).toHaveLength(changeLogsBefore.length);

    const audits = await menuDeletedAudits(menu.lineageId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({
      hadPublished: true,
      versions: 2,
    });

    expect(await getPublicMenu(db, restaurant.slug, menu.slug)).toBeNull();
    expect(
      await listMenusForRestaurant(db, admin.id, restaurant.id),
    ).toHaveLength(0);
  });

  it("deletes a lineage from an archived historical version when permissions allow", async () => {
    const { admin, editor, restaurant } = await setup();
    await setRestaurantPermission(
      db,
      admin.id,
      restaurant.id,
      editor.id,
      { canEditMenu: true, canPublishMenu: true },
    );

    const first = await createMenu(db, admin.id, restaurant.id, {
      title: "Versioned Menu",
    });
    const category = await createCategory(db, admin.id, first.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, first.id, itemInput(category.id));
    await publishMenu(db, admin.id, first.id);

    const draft = await startEditingMenu(db, admin.id, first.id);
    await publishMenu(db, admin.id, draft.id);

    const before = await db
      .select()
      .from(menus)
      .where(eq(menus.lineageId, first.lineageId));
    expect(before.find((row) => row.id === first.id)?.status).toBe("archived");

    const deleted = await deleteMenu(db, editor.id, first.id);
    expect(deleted.id).toBe(first.id);
    expect(deleted.status).toBe("archived");

    const after = await db
      .select()
      .from(menus)
      .where(eq(menus.lineageId, first.lineageId));
    expect(after).toHaveLength(2);
    expect(after.every((row) => row.status === "archived")).toBe(true);
    expect(await menuDeletedAudits(first.lineageId)).toHaveLength(1);
  });

  it("writes one deletion audit event across repeated deletes", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Repeat Delete",
    });

    await deleteMenu(db, admin.id, menu.id);
    await deleteMenu(db, admin.id, menu.id);

    const concurrent = await Promise.allSettled([
      deleteMenu(db, admin.id, menu.id),
      deleteMenu(db, admin.id, menu.id),
    ]);
    expect(
      concurrent.every((result) => result.status === "fulfilled"),
    ).toBe(true);

    expect(await menuDeletedAudits(menu.lineageId)).toHaveLength(1);
  });

  it("rejects deleting a menu when the restaurant is archived", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Archived Restaurant Menu",
    });

    await setRestaurantArchived(db, admin.id, restaurant.id, true);

    await expect(
      deleteMenu(db, admin.id, menu.id),
    ).rejects.toBeInstanceOf(ConflictError);

    const rows = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menu.id));
    expect(rows[0]?.status).toBe("draft");
    expect(await menuDeletedAudits(menu.lineageId)).toHaveLength(0);
  });

  it("allows a deleted menu slug to be reused", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });

    await deleteMenu(db, admin.id, menu.id);

    const replacement = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    expect(replacement.slug).toBe("lunch");
    expect(replacement.lineageId).not.toBe(menu.lineageId);
  });

  it("serializes concurrent publish and delete without leaving an active lineage", async () => {
    const { admin, restaurant } = await setup();
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Race Menu",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, itemInput(category.id));
    await publishMenu(db, admin.id, menu.id);
    const draft = await startEditingMenu(db, admin.id, menu.id);

    const results = await Promise.allSettled([
      publishMenu(db, admin.id, draft.id),
      deleteMenu(db, admin.id, draft.id),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const rows = await db
      .select()
      .from(menus)
      .where(eq(menus.lineageId, menu.lineageId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.status === "archived")).toBe(true);
    expect(await menuDeletedAudits(menu.lineageId)).toHaveLength(1);
  });
});
