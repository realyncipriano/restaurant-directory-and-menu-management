import "server-only";

import { and, eq, ne, or } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import type { DbClient } from "@/db/client";
import {
  menuCategories,
  menuItems,
  restaurants,
} from "@/db/schema";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { writeAuditLog } from "./audit";
import { lockDraftMenu, requireDraftEditable } from "./menu-access";
import { requireRestaurantPermission } from "./restaurant-access";
import {
  buildObjectKey,
  deleteObject,
  getPublicUrl,
  isPublicStorageConfigured,
  putObject,
} from "./storage";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isImageStorageConfigured(): boolean {
  return isPublicStorageConfigured();
}

export function getPublicImageUrl(
  objectKey: string | null | undefined,
): string | null {
  return getPublicUrl(objectKey);
}

export type PreparedImage = {
  buffer: Buffer;
  width: number | null;
  height: number | null;
  contentType: "image/webp";
};

export async function prepareImage(
  file: FormDataEntryValue | null,
): Promise<PreparedImage> {
  if (!(file instanceof File)) {
    throw new ValidationError("Choose an image file to upload.");
  }
  if (file.size === 0) {
    throw new ValidationError("The selected image is empty.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ValidationError("Images must be 5 MB or smaller.");
  }

  const input = Buffer.from(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !ALLOWED_IMAGE_MIME.has(detected.mime)) {
    throw new ValidationError("Upload a JPEG, PNG, or WebP image.");
  }

  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: 40_000_000,
      sequentialRead: true,
    }).rotate();
    const output = await image
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: output.data,
      width: output.info.width ?? null,
      height: output.info.height ?? null,
      contentType: "image/webp",
    };
  } catch {
    throw new ValidationError("That image could not be processed.");
  }
}

async function putImage(
  image: PreparedImage,
  prefix: string,
): Promise<string> {
  if (!isPublicStorageConfigured()) {
    throw new ConflictError(
      "Image storage is not configured. Set the R2 credentials and public base URL.",
    );
  }

  const key = buildObjectKey(prefix, "webp");
  await putObject(key, image.buffer, image.contentType);
  return key;
}

export async function deleteImageObject(
  objectKey: string | null | undefined,
): Promise<void> {
  await deleteObject(objectKey);
}

async function isImageObjectReferenced(
  db: DbClient,
  objectKey: string,
  exceptItemId?: string,
): Promise<boolean> {
  const [itemReference] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.imageObjectKey, objectKey),
        exceptItemId ? ne(menuItems.id, exceptItemId) : undefined,
      ),
    )
    .limit(1);
  if (itemReference) return true;

  const [restaurantReference] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(
      or(
        eq(restaurants.logoObjectKey, objectKey),
        eq(restaurants.coverObjectKey, objectKey),
      ),
    )
    .limit(1);
  return Boolean(restaurantReference);
}

export async function deleteImageObjectIfUnreferenced(
  db: DbClient,
  objectKey: string | null | undefined,
  exceptItemId?: string,
): Promise<void> {
  if (!objectKey) return;
  if (await isImageObjectReferenced(db, objectKey, exceptItemId)) return;
  await deleteObject(objectKey);
}

export async function setRestaurantImage(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  kind: "logo" | "cover",
  file: FormDataEntryValue | null,
): Promise<string> {
  const access = await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "manageRestaurant",
  );
  if (access.restaurant.status !== "active") {
    throw new ConflictError(
      "Reactivate the restaurant before changing its images.",
    );
  }

  const image = await prepareImage(file);
  const key = await putImage(image, `restaurants/${restaurantId}/${kind}`);
  const previous =
    kind === "logo"
      ? access.restaurant.logoObjectKey
      : access.restaurant.coverObjectKey;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(restaurants)
        .set(
          kind === "logo"
            ? { logoObjectKey: key, updatedAt: new Date() }
            : { coverObjectKey: key, updatedAt: new Date() },
        )
        .where(eq(restaurants.id, restaurantId));

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action:
          kind === "logo"
            ? "restaurant_logo_updated"
            : "restaurant_cover_updated",
        entityType: "restaurant",
        entityId: restaurantId,
        details: { kind },
      });
    });
  } catch (error) {
    await deleteImageObject(key);
    throw error;
  }

  await deleteImageObject(previous);
  return key;
}

export async function removeRestaurantImage(
  db: DbClient,
  actorId: string,
  restaurantId: string,
  kind: "logo" | "cover",
): Promise<void> {
  const access = await requireRestaurantPermission(
    db,
    actorId,
    restaurantId,
    "manageRestaurant",
  );
  if (access.restaurant.status !== "active") {
    throw new ConflictError(
      "Reactivate the restaurant before changing its images.",
    );
  }

  const previous =
    kind === "logo"
      ? access.restaurant.logoObjectKey
      : access.restaurant.coverObjectKey;
  if (!previous) return;

  await db.transaction(async (tx) => {
    await tx
      .update(restaurants)
      .set(
        kind === "logo"
          ? { logoObjectKey: null, updatedAt: new Date() }
          : { coverObjectKey: null, updatedAt: new Date() },
      )
      .where(eq(restaurants.id, restaurantId));

    await writeAuditLog(tx, {
      actor: { id: access.actor.id, email: access.actor.email },
      action:
        kind === "logo"
          ? "restaurant_logo_removed"
          : "restaurant_cover_removed",
      entityType: "restaurant",
      entityId: restaurantId,
      details: { kind },
    });
  });

  await deleteImageObject(previous);
}

export async function setMenuItemImage(
  db: DbClient,
  actorId: string,
  menuId: string,
  itemId: string,
  file: FormDataEntryValue | null,
): Promise<string> {
  const { access } = await requireDraftEditable(db, actorId, menuId);

  const [row] = await db
    .select({ item: menuItems })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(
      and(eq(menuItems.id, itemId), eq(menuCategories.menuId, menuId)),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Menu item not found.");

  const image = await prepareImage(file);
  const key = await putImage(
    image,
    `restaurants/${access.restaurant.id}/items/${itemId}`,
  );

  try {
    await db.transaction(async (tx) => {
      await lockDraftMenu(tx, menuId);
      await tx
        .update(menuItems)
        .set({ imageObjectKey: key, updatedAt: new Date() })
        .where(eq(menuItems.id, itemId));

      await writeAuditLog(tx, {
        actor: { id: access.actor.id, email: access.actor.email },
        action: "item_image_updated",
        entityType: "menu_item",
        entityId: itemId,
        details: { menuId, restaurantId: access.restaurant.id },
      });
    });
  } catch (error) {
    await deleteImageObject(key);
    throw error;
  }

  await deleteImageObjectIfUnreferenced(db, row.item.imageObjectKey, itemId);
  return key;
}

export async function removeMenuItemImage(
  db: DbClient,
  actorId: string,
  menuId: string,
  itemId: string,
): Promise<void> {
  const { access } = await requireDraftEditable(db, actorId, menuId);

  const [row] = await db
    .select({ item: menuItems })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(
      and(eq(menuItems.id, itemId), eq(menuCategories.menuId, menuId)),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Menu item not found.");
  if (!row.item.imageObjectKey) return;

  await db.transaction(async (tx) => {
    await lockDraftMenu(tx, menuId);
    await tx
      .update(menuItems)
      .set({ imageObjectKey: null, updatedAt: new Date() })
      .where(eq(menuItems.id, itemId));

    await writeAuditLog(tx, {
      actor: { id: access.actor.id, email: access.actor.email },
      action: "item_image_removed",
      entityType: "menu_item",
      entityId: itemId,
      details: { menuId, restaurantId: access.restaurant.id },
    });
  });

  await deleteImageObjectIfUnreferenced(db, row.item.imageObjectKey, itemId);
}
