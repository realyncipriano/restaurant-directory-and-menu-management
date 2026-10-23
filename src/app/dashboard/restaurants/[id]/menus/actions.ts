"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formStateFromError } from "@/lib/action-error";
import { formString, type FormState } from "@/lib/action-state";
import { getActionUserId } from "@/lib/auth/action-user";
import { revalidateMenuPaths } from "@/lib/revalidate";
import { itemInputSchema } from "@/lib/validation/menu";
import { parseOrThrow } from "@/lib/validation/parse";
import {
  createMenu,
  discardDraft,
  publishMenu,
  startEditingMenu,
  updateMenuSettings,
} from "@/server/services/menus";
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  updateCategory,
  updateMenuItem,
} from "@/server/services/menu-content";
import {
  removeMenuItemImage,
  setMenuItemImage,
} from "@/server/services/images";

function parseRows(
  formData: FormData,
  key: "variants" | "modifiers",
): unknown[] | null {
  const raw = formString(formData, key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function createMenuAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");

  let menuId: string;
  try {
    const menu = await createMenu(getDb(), actorId, restaurantId, {
      title: formString(formData, "title"),
      slug: formString(formData, "slug") || undefined,
      description: formString(formData, "description"),
    });
    menuId = menu.id;
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  redirect(`/dashboard/restaurants/${restaurantId}/menus/${menuId}`);
}

export async function updateMenuSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");

  try {
    await updateMenuSettings(getDb(), actorId, menuId, {
      title: formString(formData, "title"),
      slug: formString(formData, "slug") || undefined,
      description: formString(formData, "description"),
    });
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/menus/${menuId}?notice=settings`,
  );
}

export async function startDraftAction(formData: FormData): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");

  let draftId: string;
  try {
    const draft = await startEditingMenu(getDb(), actorId, menuId);
    draftId = draft.id;
  } catch {
    redirect(
      `/dashboard/restaurants/${restaurantId}/menus/${menuId}?error=draft`,
    );
  }

  revalidateMenuPaths(restaurantId, draftId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/menus/${draftId}?notice=draft`,
  );
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");

  try {
    await discardDraft(getDb(), actorId, menuId);
  } catch {
    redirect(
      `/dashboard/restaurants/${restaurantId}/menus/${menuId}?error=discard`,
    );
  }

  revalidateMenuPaths(restaurantId, menuId);
  redirect(`/dashboard/restaurants/${restaurantId}/menus?notice=discarded`);
}

export async function publishMenuAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");

  try {
    await publishMenu(getDb(), actorId, menuId);
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/menus/${menuId}?notice=published`,
  );
}

function categoryFields(formData: FormData) {
  return {
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    sortOrder: formString(formData, "sortOrder") || "0",
  };
}

export async function createCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");

  try {
    await createCategory(
      getDb(),
      actorId,
      menuId,
      categoryFields(formData),
    );
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  return { success: "Category added." };
}

export async function updateCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const categoryId = formString(formData, "categoryId");

  try {
    await updateCategory(
      getDb(),
      actorId,
      menuId,
      categoryId,
      categoryFields(formData),
    );
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  return { success: "Category saved." };
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const categoryId = formString(formData, "categoryId");

  try {
    await deleteCategory(getDb(), actorId, menuId, categoryId);
  } catch {
    redirect(
      `/dashboard/restaurants/${restaurantId}/menus/${menuId}?error=delete-category`,
    );
  }

  revalidateMenuPaths(restaurantId, menuId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/menus/${menuId}?notice=category-deleted`,
  );
}

function itemFields(formData: FormData): Record<string, unknown> | null {
  const variants = parseRows(formData, "variants");
  const modifiers = parseRows(formData, "modifiers");
  if (!variants || !modifiers) return null;

  return {
    categoryId: formString(formData, "categoryId"),
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    basePrice: formString(formData, "basePrice"),
    availabilityStatus:
      formString(formData, "availabilityStatus") || "available",
    sortOrder: formString(formData, "sortOrder") || "0",
    variants,
    modifiers,
  };
}

export async function createItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const fields = itemFields(formData);
  if (!fields) return { error: "The item options could not be read." };

  try {
    const parsed = parseOrThrow(itemInputSchema, fields);
    await createMenuItem(getDb(), actorId, menuId, parsed);
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  return { success: "Item added." };
}

export async function updateItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const itemId = formString(formData, "itemId");
  const fields = itemFields(formData);
  if (!fields) return { error: "The item options could not be read." };

  try {
    const parsed = parseOrThrow(itemInputSchema, fields);
    await updateMenuItem(getDb(), actorId, menuId, itemId, parsed);
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  return { success: "Item saved." };
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const itemId = formString(formData, "itemId");

  try {
    await deleteMenuItem(getDb(), actorId, menuId, itemId);
  } catch {
    redirect(
      `/dashboard/restaurants/${restaurantId}/menus/${menuId}?error=delete-item`,
    );
  }

  revalidateMenuPaths(restaurantId, menuId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/menus/${menuId}?notice=item-deleted`,
  );
}

export async function uploadItemImageAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const itemId = formString(formData, "itemId");

  try {
    await setMenuItemImage(
      getDb(),
      actorId,
      menuId,
      itemId,
      formData.get("image"),
    );
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateMenuPaths(restaurantId, menuId);
  return { success: "Item photo updated." };
}

export async function removeItemImageAction(formData: FormData): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const itemId = formString(formData, "itemId");

  try {
    await removeMenuItemImage(getDb(), actorId, menuId, itemId);
  } catch {
    redirect(
      `/dashboard/restaurants/${restaurantId}/menus/${menuId}?error=image`,
    );
  }

  revalidateMenuPaths(restaurantId, menuId);
  return;
}
