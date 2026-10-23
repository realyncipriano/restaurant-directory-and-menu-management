"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formStateFromError } from "@/lib/action-error";
import { formString, type FormState } from "@/lib/action-state";
import { getActionUserId } from "@/lib/auth/action-user";
import {
  revalidateRestaurantAccess,
  revalidateRestaurantDetail,
  revalidateRestaurantList,
} from "@/lib/revalidate";
import {
  removeRestaurantImage,
  setRestaurantImage,
} from "@/server/services/images";
import {
  createRestaurant,
  removeRestaurantPermission,
  setRestaurantArchived,
  setRestaurantPermission,
  updateRestaurant,
} from "@/server/services/restaurants";

function restaurantFields(formData: FormData) {
  return {
    name: formString(formData, "name"),
    slug: formString(formData, "slug") || undefined,
    description: formString(formData, "description"),
    cuisineType: formString(formData, "cuisineType"),
    address: formString(formData, "address"),
    location: formString(formData, "location"),
    contactPhone: formString(formData, "contactPhone"),
    contactEmail: formString(formData, "contactEmail"),
    operatingHours: formString(formData, "operatingHours"),
  };
}

export async function createRestaurantAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");

  let restaurantId: string;
  try {
    const restaurant = await createRestaurant(
      getDb(),
      actorId,
      restaurantFields(formData),
    );
    restaurantId = restaurant.id;
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateRestaurantList();
  redirect(`/dashboard/restaurants/${restaurantId}`);
}

export async function updateRestaurantAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");

  const restaurantId = formString(formData, "restaurantId");
  try {
    await updateRestaurant(
      getDb(),
      actorId,
      restaurantId,
      restaurantFields(formData),
    );
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateRestaurantList();
  revalidateRestaurantDetail(restaurantId);
  redirect(`/dashboard/restaurants/${restaurantId}?notice=updated`);
}

export async function archiveRestaurantAction(
  formData: FormData,
): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");

  try {
    await setRestaurantArchived(getDb(), actorId, restaurantId, true);
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}?error=archive`);
  }

  revalidateRestaurantList();
  redirect(`/dashboard/restaurants/${restaurantId}?notice=archived`);
}

export async function activateRestaurantAction(
  formData: FormData,
): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");

  try {
    await setRestaurantArchived(getDb(), actorId, restaurantId, false);
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}?error=activate`);
  }

  revalidateRestaurantList();
  redirect(`/dashboard/restaurants/${restaurantId}?notice=activated`);
}

export async function setPermissionAction(
  formData: FormData,
): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");

  const restaurantId = formString(formData, "restaurantId");
  const userId = formString(formData, "userId");

  try {
    await setRestaurantPermission(getDb(), actorId, restaurantId, userId, {
      canEditMenu: formData.get("canEditMenu") === "on",
      canPublishMenu: formData.get("canPublishMenu") === "on",
      canManageRestaurant: formData.get("canManageRestaurant") === "on",
    });
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}/access?error=save`);
  }

  revalidateRestaurantAccess(restaurantId);
  redirect(`/dashboard/restaurants/${restaurantId}/access?notice=saved`);
}

export async function removePermissionAction(
  formData: FormData,
): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");

  const restaurantId = formString(formData, "restaurantId");
  const userId = formString(formData, "userId");

  try {
    await removeRestaurantPermission(
      getDb(),
      actorId,
      restaurantId,
      userId,
    );
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}/access?error=remove`);
  }

  revalidateRestaurantAccess(restaurantId);
  redirect(`/dashboard/restaurants/${restaurantId}/access?notice=removed`);
}

export async function uploadRestaurantImageAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const kind = formString(formData, "kind") === "logo" ? "logo" : "cover";

  try {
    await setRestaurantImage(
      getDb(),
      actorId,
      restaurantId,
      kind,
      formData.get("image"),
    );
  } catch (error) {
    return formStateFromError(error);
  }

  revalidateRestaurantDetail(restaurantId);
  return {
    success: kind === "logo" ? "Logo updated." : "Cover image updated.",
  };
}

export async function removeRestaurantImageAction(
  formData: FormData,
): Promise<void> {
  const actorId = await getActionUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const kind = formString(formData, "kind") === "logo" ? "logo" : "cover";

  try {
    await removeRestaurantImage(getDb(), actorId, restaurantId, kind);
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}?error=image`);
  }

  revalidateRestaurantDetail(restaurantId);
  redirect(`/dashboard/restaurants/${restaurantId}?notice=image-removed`);
}
