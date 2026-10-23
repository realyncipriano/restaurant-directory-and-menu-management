import { and, eq, ne } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { menuChangeLogs, menus } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { writeAuditLog } from "../audit";
import { diffMenuTrees, type MenuChangeAction } from "../menu-diff";
import { lockDraftMenu, requireMenuPermission } from "../menu-access";
import { loadMenuTree, type MenuRecord } from "../menu-tree";

async function writeChange(
  db: DbExecutor,
  input: {
    restaurantId: string;
    menuId: string;
    logicalId: string | null;
    itemId: string | null;
    action: MenuChangeAction;
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

  const now = new Date();

  return db.transaction(async (tx) => {
    const current = await lockDraftMenu(tx, menu.id);

    const tree = await loadMenuTree(tx, current.id);
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

    const [slugConflict] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(
        and(
          eq(menus.restaurantId, current.restaurantId),
          eq(menus.slug, current.slug),
          eq(menus.status, "published"),
          ne(menus.lineageId, current.lineageId),
        ),
      )
      .limit(1);

    if (slugConflict) {
      throw new ConflictError(
        "Another published menu already uses this URL slug. Rename this menu first.",
      );
    }

    const [previous] = await tx
      .select()
      .from(menus)
      .where(
        and(
          eq(menus.restaurantId, current.restaurantId),
          eq(menus.lineageId, current.lineageId),
          eq(menus.status, "published"),
          ne(menus.id, current.id),
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

    const changes = diffMenuTrees(previousTree, tree);
    if (changes.length > 0) {
      await tx.insert(menuChangeLogs).values(
        changes.map((change) => ({
          restaurantId: published.restaurantId,
          menuId: published.id,
          menuItemLogicalId: change.logicalId,
          menuItemId: change.itemId,
          action: change.action,
          previousValues: change.previousValues ?? null,
          newValues: change.newValues ?? null,
          changedBy: access.actor.id,
          createdAt: now,
        })),
      );
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
