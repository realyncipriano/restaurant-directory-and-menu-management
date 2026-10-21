"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { formString, type FormState } from "@/lib/action-state";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
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

function messageFor(error: unknown): FormState {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: error.fieldErrors };
  }
  if (
    error instanceof ConflictError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof AppError
  ) {
    return { error: error.message };
  }
  return { error: "Something went wrong. Please try again." };
}

async function currentUserId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.id ?? null;
}

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
  const actorId = await currentUserId();
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
    return messageFor(error);
  }

  revalidatePath("/dashboard/restaurants");
  redirect(`/dashboard/restaurants/${restaurantId}`);
}

export async function updateRestaurantAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await currentUserId();
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
    return messageFor(error);
  }

  revalidatePath("/dashboard/restaurants");
  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
  redirect(`/dashboard/restaurants/${restaurantId}?notice=updated`);
}

export async function archiveRestaurantAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");

  try {
    await setRestaurantArchived(getDb(), actorId, restaurantId, true);
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}?error=archive`);
  }

  revalidatePath("/dashboard/restaurants");
  redirect(`/dashboard/restaurants/${restaurantId}?notice=archived`);
}

export async function activateRestaurantAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");

  try {
    await setRestaurantArchived(getDb(), actorId, restaurantId, false);
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}?error=activate`);
  }

  revalidatePath("/dashboard/restaurants");
  redirect(`/dashboard/restaurants/${restaurantId}?notice=activated`);
}

export async function setPermissionAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
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

  revalidatePath(`/dashboard/restaurants/${restaurantId}/access`);
  redirect(`/dashboard/restaurants/${restaurantId}/access?notice=saved`);
}

export async function removePermissionAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
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

  revalidatePath(`/dashboard/restaurants/${restaurantId}/access`);
  redirect(`/dashboard/restaurants/${restaurantId}/access?notice=removed`);
}

export async function uploadRestaurantImageAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await currentUserId();
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
    return messageFor(error);
  }

  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
  return {
    success: kind === "logo" ? "Logo updated." : "Cover image updated.",
  };
}

export async function removeRestaurantImageAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const kind = formString(formData, "kind") === "logo" ? "logo" : "cover";

  try {
    await removeRestaurantImage(getDb(), actorId, restaurantId, kind);
  } catch {
    redirect(`/dashboard/restaurants/${restaurantId}?error=image`);
  }

  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
  redirect(`/dashboard/restaurants/${restaurantId}?notice=image-removed`);
}
