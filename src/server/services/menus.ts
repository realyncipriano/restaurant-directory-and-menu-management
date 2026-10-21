import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  max,
  ne,
} from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { isUniqueViolation } from "@/db/pool-errors";
import {
  menuCategories,
  menuChangeLogs,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation/parse";
import { menuInputSchema } from "@/lib/validation/menu";
import { writeAuditLog } from "./audit";
import {
  loadMenuTree,
  type MenuRecord,
  type MenuTreeItem,
} from "./menu-tree";
import {
  getMenuAccess,
  requireDraftEditable,
  requireMenuPermission,
} from "./menu-access";
import {
  getRestaurantAccess,
  requireRestaurantPermission,
} from "./restaurant-access";

async function menuSlugTaken(
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

function slugifyTitle(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "menu"
  );
}

async function uniqueMenuSlug(
  db: DbExecutor,
  restaurantId: string,
  title: string,
): Promise<string> {
  const base = slugifyTitle(title);
  if (!(await menuSlugTaken(db, restaurantId, base))) return base;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${base.slice(0, 80 - String(suffix).length - 1)}-${suffix}`;
    if (!(await menuSlugTaken(db, restaurantId, candidate))) {
      return candidate;
    }
  }

  throw new ConflictError(
    "Could not generate a unique menu slug. Enter a different slug.",
  );
}

export async function createMenu(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  input: { title: string; slug?: string; description?: string },
): Promise<MenuRecord> {
  const access = await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "editMenu",
  );
  if (access.restaurant.status !== "active") {
    throw new ConflictError(
      "Archived restaurants cannot receive new menus. Reactivate it first.",
    );
  }

  const parsed = parseOrThrow(menuInputSchema, input);
  const now = new Date();

  if (parsed.slug && (await menuSlugTaken(db, restaurantId, parsed.slug))) {
    throw new ConflictError("That menu URL slug is already in use.");
  }

  try {
    return await db.transaction(async (tx) => {
      const slug =
        parsed.slug ??
        (await uniqueMenuSlug(tx, restaurantId, parsed.title));

      const menuId = randomUUID();
      const [menu] = await tx
        .insert(menus)
        .values({
          id: menuId,
          lineageId: menuId,
          restaurantId,
          title: parsed.title,
          slug,
          description: parsed.description,
          status: "draft",
          version: 1,
          lastUpdatedAt: now,
          createdBy: access.actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!menu) throw new ConflictError("Could not create the menu.");

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action: "menu_created",
        entityType: "menu",
        entityId: menu.id,
        details: { restaurantId, title: menu.title, slug: menu.slug },
      });

      return menu;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That menu URL slug is already in use.");
    }
    throw error;
  }
}

export type MenuLineageSummary = {
  lineageId: string;
  title: string;
  published: MenuRecord | null;
  draft: MenuRecord | null;
  latestVersion: number;
  publishedItemCount: number;
  draftItemCount: number;
  updatedAt: Date;
};

export async function listMenusForRestaurant(
  db: DbClient,
  actorId: string,
  restaurantId: string,
): Promise<MenuLineageSummary[]> {
  await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "viewManagement",
  );

  const rows = await db
    .select()
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, restaurantId),
        ne(menus.status, "archived"),
      ),
    )
    .orderBy(desc(menus.version), asc(menus.title));

  if (rows.length === 0) return [];

  const menuIds = rows.map((menu) => menu.id);
  const countRows = await db
    .select({
      menuId: menuCategories.menuId,
      total: count(menuItems.id),
    })
    .from(menuCategories)
    .leftJoin(menuItems, eq(menuItems.categoryId, menuCategories.id))
    .where(inArray(menuCategories.menuId, menuIds))
    .groupBy(menuCategories.menuId);

  const counts = new Map(
    countRows.map((row) => [row.menuId, row.total] as const),
  );

  const byLineage = new Map<string, MenuRecord[]>();
  for (const menu of rows) {
    const list = byLineage.get(menu.lineageId) ?? [];
    list.push(menu);
    byLineage.set(menu.lineageId, list);
  }

  const summaries: MenuLineageSummary[] = [];
  for (const [lineageId, versions] of byLineage) {
    const published =
      versions.find((menu) => menu.status === "published") ?? null;
    const draft = versions.find((menu) => menu.status === "draft") ?? null;
    if (!published && !draft) continue;

    const latest =
      [...versions].sort((left, right) => right.version - left.version)[0] ??
      versions[0]!;
    const primary = draft ?? published ?? latest;

    summaries.push({
      lineageId,
      title: primary.title,
      published,
      draft,
      latestVersion: latest.version,
      publishedItemCount: published ? (counts.get(published.id) ?? 0) : 0,
      draftItemCount: draft ? (counts.get(draft.id) ?? 0) : 0,
      updatedAt: primary.updatedAt,
    });
  }

  return summaries.sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}

export async function getMenuManagement(
  db: DbClient,
  actorId: string,
  menuId: string,
) {
  const { menu, access } = await requireMenuPermission(
    db,
    actorId,
    menuId,
    "viewManagement",
  );

  const tree = await loadMenuTree(db, menuId);
  if (!tree) throw new NotFoundError("Menu not found.");

  const versions = await db
    .select()
    .from(menus)
    .where(eq(menus.lineageId, menu.lineageId))
    .orderBy(desc(menus.version));

  const changes = await db
    .select()
    .from(menuChangeLogs)
    .where(eq(menuChangeLogs.menuId, menuId))
    .orderBy(desc(menuChangeLogs.createdAt))
    .limit(50);

  return { menu, access, tree, versions, changes };
}

export async function startEditingMenu(
  db: DbClient,
  actorId: string,
  menuId: string,
): Promise<MenuRecord> {
  const { menu, access } = await requireMenuPermission(
    db,
    actorId,
    menuId,
    "editMenu",
  );

  if (access.restaurant.status !== "active") {
    throw new ConflictError(
      "Archived restaurants cannot be edited. Reactivate it first.",
    );
  }

  if (menu.status === "draft") return menu;

  const [existingDraft] = await db
    .select()
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, menu.restaurantId),
        eq(menus.lineageId, menu.lineageId),
        eq(menus.status, "draft"),
      ),
    )
    .limit(1);

  if (existingDraft) return existingDraft;

  let source = menu;
  if (menu.status === "archived") {
    const [published] = await db
      .select()
      .from(menus)
      .where(
        and(
          eq(menus.restaurantId, menu.restaurantId),
          eq(menus.lineageId, menu.lineageId),
          eq(menus.status, "published"),
        ),
      )
      .limit(1);

    if (!published) {
      throw new ConflictError(
        "This archived menu has no published version to edit.",
      );
    }
    source = published;
  }

  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [versionRow] = await tx
        .select({ version: max(menus.version) })
        .from(menus)
        .where(
          and(
            eq(menus.restaurantId, menu.restaurantId),
            eq(menus.lineageId, menu.lineageId),
          ),
        );
      const nextVersion = Number(versionRow?.version ?? 0) + 1;

      const [draft] = await tx
        .insert(menus)
        .values({
          restaurantId: source.restaurantId,
          title: source.title,
          slug: source.slug,
          description: source.description,
          status: "draft",
          lineageId: source.lineageId,
          version: nextVersion,
          clonedFromMenuId: source.id,
          lastUpdatedAt: now,
          createdBy: access.actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!draft) throw new ConflictError("Could not create a draft.");

      const sourceTree = await loadMenuTree(tx, source.id);
      if (!sourceTree) throw new NotFoundError("Source menu not found.");

      for (const category of sourceTree.categories) {
        const [newCategory] = await tx
          .insert(menuCategories)
          .values({
            menuId: draft.id,
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!newCategory) continue;

        for (const item of category.items) {
          const [newItem] = await tx
            .insert(menuItems)
            .values({
              categoryId: newCategory.id,
              logicalId: item.logicalId,
              name: item.name,
              description: item.description,
              basePriceMinor: item.basePriceMinor,
              currency: item.currency,
              imageObjectKey: item.imageObjectKey,
              availabilityStatus: item.availabilityStatus,
              sortOrder: item.sortOrder,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          if (!newItem) continue;

          if (item.variants.length > 0) {
            await tx.insert(menuItemVariants).values(
              item.variants.map((variant) => ({
                menuItemId: newItem.id,
                name: variant.name,
                priceMinor: variant.priceMinor,
                sortOrder: variant.sortOrder,
                createdAt: now,
              })),
            );
          }

          if (item.modifiers.length > 0) {
            await tx.insert(menuItemModifiers).values(
              item.modifiers.map((modifier) => ({
                menuItemId: newItem.id,
                name: modifier.name,
                additionalPriceMinor: modifier.additionalPriceMinor,
                isAvailable: modifier.isAvailable,
                sortOrder: modifier.sortOrder,
                createdAt: now,
              })),
            );
          }
        }
      }

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action: "menu_duplicated",
        entityType: "menu",
        entityId: draft.id,
        details: {
          restaurantId: draft.restaurantId,
          lineageId: draft.lineageId,
          fromMenuId: source.id,
          fromVersion: source.version,
          toVersion: draft.version,
        },
      });

      return draft;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [draft] = await db
        .select()
        .from(menus)
        .where(
          and(
            eq(menus.restaurantId, menu.restaurantId),
            eq(menus.lineageId, menu.lineageId),
            eq(menus.status, "draft"),
          ),
        )
        .limit(1);
      if (draft) return draft;
    }
    throw error;
  }
}

export async function updateMenuSettings(
  db: DbClient,
  actorId: string,
  menuId: string,
  input: { title: string; slug?: string; description?: string },
): Promise<MenuRecord> {
  const { menu, access } = await requireDraftEditable(db, actorId, menuId);
  const parsed = parseOrThrow(menuInputSchema, input);

  if (
    parsed.slug &&
    parsed.slug !== menu.slug &&
    (await menuSlugTaken(
      db,
      menu.restaurantId,
      parsed.slug,
      menu.lineageId,
    ))
  ) {
    throw new ConflictError("That menu URL slug is already in use.");
  }

  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(menus)
        .set({
          title: parsed.title,
          slug: parsed.slug ?? menu.slug,
          description: parsed.description,
          lastUpdatedAt: now,
          updatedAt: now,
        })
        .where(and(eq(menus.id, menu.id), eq(menus.status, "draft")))
        .returning();

      if (!updated) {
        throw new ConflictError("This menu is no longer a draft.");
      }

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action: "menu_updated",
        entityType: "menu",
        entityId: updated.id,
        details: { fields: ["title", "slug", "description"] },
      });

      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That menu URL slug is already in use.");
    }
    throw error;
  }
}

export async function discardDraft(
  db: DbClient,
  actorId: string,
  menuId: string,
): Promise<void> {
  const { menu, access } = await requireDraftEditable(db, actorId, menuId);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(menus)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(menus.id, menu.id), eq(menus.status, "draft")));

    await writeAuditLog(tx, {
      actor: { id: access.actor.id, email: access.actor.email },
      action: "menu_archived",
      entityType: "menu",
      entityId: menu.id,
      details: { kind: "draft", version: menu.version },
    });
  });
}

function itemSnapshot(item: MenuTreeItem) {
  return {
    name: item.name,
    description: item.description,
    basePriceMinor: item.basePriceMinor,
    availabilityStatus: item.availabilityStatus,
    variants: [...item.variants]
      .map((variant) => ({
        name: variant.name,
        priceMinor: variant.priceMinor,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    modifiers: [...item.modifiers]
      .map((modifier) => ({
        name: modifier.name,
        additionalPriceMinor: modifier.additionalPriceMinor,
        isAvailable: modifier.isAvailable,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function snapshotsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeChange(
  db: DbExecutor,
  input: {
    restaurantId: string;
    menuId: string;
    logicalId: string | null;
    itemId: string | null;
    action:
      | "item_created"
      | "item_updated"
      | "item_deleted"
      | "item_availability_changed"
      | "price_changed"
      | "category_created"
      | "category_updated"
      | "category_deleted"
      | "menu_published";
    previousValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    actorId: string;
    createdAt: Date;
  },
): Promise<void> {
  await db.insert(menuChangeLogs).values({
    restaurantId: input.restaurantId,
    menuId: input.menuId,
    menuItemLogicalId: input.logicalId,
    menuItemId: input.itemId,
    action: input.action,
    previousValues: input.previousValues ?? null,
    newValues: input.newValues ?? null,
    changedBy: input.actorId,
    createdAt: input.createdAt,
  });
}

export async function publishMenu(
  db: DbClient,
  actorId: string,
  menuId: string,
): Promise<MenuRecord> {
  const { menu, access } = await requireMenuPermission(
    db,
    actorId,
    menuId,
    "publishMenu",
  );

  if (access.restaurant.status !== "active") {
    throw new ConflictError(
      "Archived restaurants cannot publish menus. Reactivate it first.",
    );
  }
  if (menu.status !== "draft") {
    throw new ConflictError("Only draft menus can be published.");
  }

  const tree = await loadMenuTree(db, menu.id);
  if (!tree) throw new NotFoundError("Menu not found.");

  if (tree.categories.length === 0) {
    throw new ValidationError(
      "Add at least one category before publishing this menu.",
    );
  }

  const allItems = tree.categories.flatMap((category) => category.items);
  if (allItems.length === 0) {
    throw new ValidationError(
      "Add at least one menu item before publishing.",
    );
  }

  const unpriced = allItems.find(
    (item) =>
      item.basePriceMinor === null && item.variants.length === 0,
  );
  if (unpriced) {
    throw new ValidationError(
      `Add a price or a priced variant for “${unpriced.name}” before publishing.`,
    );
  }

  const [slugConflict] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, menu.restaurantId),
        eq(menus.slug, menu.slug),
        eq(menus.status, "published"),
        ne(menus.lineageId, menu.lineageId),
      ),
    )
    .limit(1);

  if (slugConflict) {
    throw new ConflictError(
      "Another published menu already uses this URL slug. Rename this menu first.",
    );
  }

  const now = new Date();

  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(menus)
      .where(
        and(
          eq(menus.restaurantId, menu.restaurantId),
          eq(menus.lineageId, menu.lineageId),
          eq(menus.status, "published"),
          ne(menus.id, menu.id),
        ),
      )
      .limit(1);

    const previousTree = previous
      ? await loadMenuTree(tx, previous.id)
      : null;

    if (previous) {
      await tx
        .update(menus)
        .set({ status: "archived", updatedAt: now })
        .where(eq(menus.id, previous.id));
    }

    const [published] = await tx
      .update(menus)
      .set({
        status: "published",
        publishedAt: now,
        lastUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(menus.id, menu.id), eq(menus.status, "draft")))
      .returning();

    if (!published) {
      throw new ConflictError("This menu can no longer be published.");
    }

    await writeChange(tx, {
      restaurantId: published.restaurantId,
      menuId: published.id,
      logicalId: null,
      itemId: null,
      action: "menu_published",
      previousValues: previous
        ? { version: previous.version, title: previous.title }
        : null,
      newValues: {
        version: published.version,
        title: published.title,
        slug: published.slug,
      },
      actorId: access.actor.id,
      createdAt: now,
    });

    const previousItems = new Map(
      (previousTree?.categories.flatMap((category) => category.items) ?? []).map(
        (item) => [item.logicalId, item] as const,
      ),
    );
    const newItems = new Map(
      allItems.map((item) => [item.logicalId, item] as const),
    );

    for (const item of allItems) {
      const previousItem = previousItems.get(item.logicalId);
      if (!previousItem) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: item.logicalId,
          itemId: item.id,
          action: "item_created",
          newValues: itemSnapshot(item),
          actorId: access.actor.id,
          createdAt: now,
        });
        continue;
      }

      const before = itemSnapshot(previousItem);
      const after = itemSnapshot(item);

      if (before.name !== after.name) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: item.logicalId,
          itemId: item.id,
          action: "item_updated",
          previousValues: { name: before.name },
          newValues: { name: after.name },
          actorId: access.actor.id,
          createdAt: now,
        });
      }

      if (before.description !== after.description) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: item.logicalId,
          itemId: item.id,
          action: "item_updated",
          previousValues: { description: before.description },
          newValues: { description: after.description },
          actorId: access.actor.id,
          createdAt: now,
        });
      }

      if (
        before.basePriceMinor !== after.basePriceMinor ||
        !snapshotsEqual(before.variants, after.variants) ||
        !snapshotsEqual(before.modifiers, after.modifiers)
      ) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: item.logicalId,
          itemId: item.id,
          action: "price_changed",
          previousValues: {
            basePriceMinor: before.basePriceMinor,
            variants: before.variants,
            modifiers: before.modifiers,
          },
          newValues: {
            basePriceMinor: after.basePriceMinor,
            variants: after.variants,
            modifiers: after.modifiers,
          },
          actorId: access.actor.id,
          createdAt: now,
        });
      }

      if (before.availabilityStatus !== after.availabilityStatus) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: item.logicalId,
          itemId: item.id,
          action: "item_availability_changed",
          previousValues: {
            availabilityStatus: before.availabilityStatus,
          },
          newValues: { availabilityStatus: after.availabilityStatus },
          actorId: access.actor.id,
          createdAt: now,
        });
      }
    }

    for (const [logicalId, item] of previousItems) {
      if (newItems.has(logicalId)) continue;
      await writeChange(tx, {
        restaurantId: published.restaurantId,
        menuId: published.id,
        logicalId,
        itemId: null,
        action: "item_deleted",
        previousValues: itemSnapshot(item),
        actorId: access.actor.id,
        createdAt: now,
      });
    }

    const previousCategories = new Map(
      (previousTree?.categories ?? []).map(
        (category) => [category.name.toLowerCase(), category] as const,
      ),
    );
    const newCategories = new Map(
      tree.categories.map(
        (category) => [category.name.toLowerCase(), category] as const,
      ),
    );

    for (const category of tree.categories) {
      const previousCategory = previousCategories.get(
        category.name.toLowerCase(),
      );
      if (!previousCategory) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: null,
          itemId: null,
          action: "category_created",
          newValues: {
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
          },
          actorId: access.actor.id,
          createdAt: now,
        });
      } else if (
        previousCategory.description !== category.description ||
        previousCategory.sortOrder !== category.sortOrder
      ) {
        await writeChange(tx, {
          restaurantId: published.restaurantId,
          menuId: published.id,
          logicalId: null,
          itemId: null,
          action: "category_updated",
          previousValues: {
            name: previousCategory.name,
            description: previousCategory.description,
            sortOrder: previousCategory.sortOrder,
          },
          newValues: {
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
          },
          actorId: access.actor.id,
          createdAt: now,
        });
      }
    }

    for (const [name, category] of previousCategories) {
      if (newCategories.has(name)) continue;
      await writeChange(tx, {
        restaurantId: published.restaurantId,
        menuId: published.id,
        logicalId: null,
        itemId: null,
        action: "category_deleted",
        previousValues: {
          name: category.name,
          description: category.description,
          sortOrder: category.sortOrder,
        },
        actorId: access.actor.id,
        createdAt: now,
      });
    }

    await writeAuditLog(tx, {
      actor: { id: access.actor.id, email: access.actor.email },
      action: "menu_published",
      entityType: "menu",
      entityId: published.id,
      details: {
        restaurantId: published.restaurantId,
        lineageId: published.lineageId,
        version: published.version,
        previousMenuId: previous?.id ?? null,
      },
    });

    return published;
  });
}

export async function getMenuContextForRestaurant(
  db: DbClient,
  actorId: string,
  restaurantId: string,
) {
  const access = await getRestaurantAccess(db, actorId, restaurantId);
  return access;
}

export { getMenuAccess };
