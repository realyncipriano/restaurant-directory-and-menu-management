"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formString, type FormState } from "@/lib/action-state";
import { getCurrentUser } from "@/lib/auth/session";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  acceptAllImportItems,
  applyMenuImport,
  createMenuImport,
  processMenuImport,
  updateImportItem,
} from "@/server/services/imports";

function messageFor(error: unknown): FormState {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof AppError) {
    return { error: error.message };
  }
  if (
    error instanceof ConflictError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError
  ) {
    return { error: error.message };
  }
  return { error: "Something went wrong. Please try again." };
}

async function currentUserId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.id ?? null;
}

function revalidateImportPaths(restaurantId: string, importId?: string): void {
  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
  revalidatePath(`/dashboard/restaurants/${restaurantId}/imports`);
  if (importId) {
    revalidatePath(
      `/dashboard/restaurants/${restaurantId}/imports/${importId}`,
    );
  }
}

export async function createImportAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const menuId = formString(formData, "menuId");
  const files = formData.getAll("pages");

  let importId: string;
  try {
    importId = await createMenuImport(
      getDb(),
      actorId,
      restaurantId,
      menuId,
      files,
    );
  } catch (error) {
    return messageFor(error);
  }

  revalidateImportPaths(restaurantId, importId);
  redirect(`/dashboard/restaurants/${restaurantId}/imports/${importId}`);
}

export async function processImportAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const importId = formString(formData, "importId");

  try {
    await processMenuImport(getDb(), actorId, importId);
  } catch (error) {
    return messageFor(error);
  }

  revalidateImportPaths(restaurantId, importId);
  return { success: "Scan processed. Review the extracted items below." };
}

export async function updateImportItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const importId = formString(formData, "importId");
  const itemId = formString(formData, "itemId");
  const decisionRaw = formString(formData, "decision");
  const decision =
    decisionRaw === "accept" || decisionRaw === "reject"
      ? decisionRaw
      : "pending";

  try {
    await updateImportItem(getDb(), actorId, importId, itemId, {
      decision,
      categoryName: formString(formData, "categoryName"),
      name: formString(formData, "name"),
      description: formString(formData, "description"),
      basePrice: formString(formData, "basePrice"),
      availabilityStatus:
        formString(formData, "availabilityStatus") === "unavailable"
          ? "unavailable"
          : "available",
    });
  } catch (error) {
    return messageFor(error);
  }

  revalidateImportPaths(restaurantId, importId);
  return {
    success:
      decision === "accept"
        ? "Accepted for import."
        : decision === "reject"
          ? "Rejected."
          : "Changes saved.",
  };
}

export async function acceptAllImportItemsAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const importId = formString(formData, "importId");

  try {
    await acceptAllImportItems(getDb(), actorId, importId);
  } catch {
    redirect(
      `/dashboard/restaurants/${restaurantId}/imports/${importId}?error=accept`,
    );
  }

  revalidateImportPaths(restaurantId, importId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/imports/${importId}?notice=accepted`,
  );
}

export async function applyImportAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const importId = formString(formData, "importId");

  let menuId: string;
  try {
    menuId = await applyMenuImport(getDb(), actorId, importId);
  } catch (error) {
    return messageFor(error);
  }

  revalidateImportPaths(restaurantId, importId);
  redirect(
    `/dashboard/restaurants/${restaurantId}/menus/${menuId}?notice=import-applied`,
  );
}
