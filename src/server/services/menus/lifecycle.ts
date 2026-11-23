import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { isUniqueViolation } from "@/db/pool-errors";
import { menus } from "@/db/schema";
import { hasRestaurantPermission } from "@/lib/auth/permissions";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation/parse";
import { menuInputSchema } from "@/lib/validation/menu";
import { writeAuditLog } from "../audit";
import {
  lockDraftMenu,
  lockMenuLineage,
  lockMenuLineageRows,
  requireDraftEditable,
  requireMenuPermission,
} from "../menu-access";
import type { MenuRecord } from "../menu-tree";
import {
  getRestaurantAccess,
  requireRestaurantPermission,
} from "../restaurant-access";
import { findMenuLineageDeletion } from "./queries";
import { menuSlugTaken, uniqueMenuSlug } from "./slugs";

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
      await lockDraftMenu(tx, menu.id);
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
    await lockMenuLineage(tx, menu.lineageId);
    await lockDraftMenu(tx, menu.id);
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

export async function deleteMenu(
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
      "Archived restaurants cannot have menus deleted. Reactivate it first.",
    );
  }

  const now = new Date();

  return db.transaction(async (tx) => {
    // Serialize against create-draft, publish, discard, and other deletes.
    await lockMenuLineage(tx, menu.lineageId);
    const versions = await lockMenuLineageRows(tx, menu.lineageId);

    const current = versions.find((version) => version.id === menu.id);
    if (!current) {
      throw new NotFoundError("Menu not found.");
    }

    // Permissions and restaurant status may have changed while this request
    // waited for the lineage lock, so revalidate them inside the transaction.
    const freshAccess = await getRestaurantAccess(
      tx,
      actorId,
      current.restaurantId,
    );

    if (
      !hasRestaurantPermission(
        freshAccess.actor.role,
        freshAccess.flags,
        "editMenu",
      )
    ) {
      throw new ForbiddenError();
    }

    if (freshAccess.restaurant.status !== "active") {
      throw new ConflictError(
        "Archived restaurants cannot have menus deleted. Reactivate it first.",
      );
    }

    const existingDeletion = await findMenuLineageDeletion(
      tx,
      current.lineageId,
    );
    if (existingDeletion) {
      // Repeated or concurrent deletes are idempotent and must not add a
      // second menu_deleted audit event.
      return current;
    }

    const hadPublished = versions.some(
      (version) => version.status === "published",
    );

    if (
      hadPublished &&
      !hasRestaurantPermission(
        freshAccess.actor.role,
        freshAccess.flags,
        "publishMenu",
      )
    ) {
      throw new ForbiddenError(
        "Deleting a published menu requires permission to publish menus.",
      );
    }

    await tx
      .update(menus)
      .set({ status: "archived", updatedAt: now })
      .where(eq(menus.lineageId, current.lineageId));

    await writeAuditLog(tx, {
      actor: {
        id: freshAccess.actor.id,
        email: freshAccess.actor.email,
      },
      action: "menu_deleted",
      entityType: "menu",
      entityId: current.id,
      details: {
        restaurantId: current.restaurantId,
        lineageId: current.lineageId,
        title: current.title,
        slug: current.slug,
        versions: versions.length,
        initiatingVersion: current.version,
        hadPublished,
      },
    });

    return { ...current, status: "archived", updatedAt: now };
  });
}
