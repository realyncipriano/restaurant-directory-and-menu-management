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
  beginMenuImport,
  confirmMenuImport,
  keepOnlyImportCategory,
  processMenuImport,
  updateImportCategoryDecision,
  updateImportItem,
  type BeginImportResult,
  type ImportCategoryDecisionResult,
  type ImportUploadFile,
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

function categoryReviewUrl(input: {
  restaurantId: string;
  importId: string;
  categoryName?: string;
  notice?: string;
  error?: string;
  result?: ImportCategoryDecisionResult;
}): string {
  const params = new URLSearchParams();
  if (input.categoryName) params.set("category", input.categoryName);
  if (input.notice) params.set("notice", input.notice);
  if (input.error) params.set("error", input.error);
  if (input.result) {
    params.set("accepted", String(input.result.accepted));
    params.set("rejected", String(input.result.rejected));
    params.set("pending", String(input.result.pending));
    params.set("pendingInCategory", String(input.result.pendingInCategory));
  }
  const query = params.toString();
  return `/dashboard/restaurants/${input.restaurantId}/imports/${input.importId}${query ? `?${query}` : ""}`;
}

export type BeginImportActionResult = {
  error?: string;
  result?: BeginImportResult;
};

export async function beginImportAction(input: {
  restaurantId: string;
  menuId: string;
  files: ImportUploadFile[];
}): Promise<BeginImportActionResult> {
  const actorId = await currentUserId();
  if (!actorId) {
    return { error: "Your session has expired. Sign in again." };
  }

  try {
    const result = await beginMenuImport(
      getDb(),
      actorId,
      input.restaurantId,
      input.menuId,
      input.files,
    );
    return { result };
  } catch (error) {
    return { error: messageFor(error).error ?? "The upload could not start." };
  }
}

export async function confirmImportAction(input: {
  restaurantId: string;
  importId: string;
}): Promise<FormState> {
  const actorId = await currentUserId();
  if (!actorId) {
    return { error: "Your session has expired. Sign in again." };
  }

  try {
    await confirmMenuImport(getDb(), actorId, input.importId);
  } catch (error) {
    return messageFor(error);
  }

  revalidateImportPaths(input.restaurantId, input.importId);
  return { success: "Scan pages uploaded." };
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

export async function updateCategoryDecisionAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const importId = formString(formData, "importId");
  const categoryName = formString(formData, "categoryName");
  const decision = formString(formData, "decision");

  if (decision !== "accept" && decision !== "reject") {
    redirect(
      categoryReviewUrl({
        restaurantId,
        importId,
        categoryName,
        error: "category",
      }),
    );
  }

  let result: ImportCategoryDecisionResult;
  try {
    result = await updateImportCategoryDecision(
      getDb(),
      actorId,
      importId,
      categoryName,
      decision,
    );
  } catch {
    redirect(
      categoryReviewUrl({
        restaurantId,
        importId,
        categoryName,
        error: "category",
      }),
    );
  }

  revalidateImportPaths(restaurantId, importId);
  redirect(
    categoryReviewUrl({
      restaurantId,
      importId,
      categoryName: result.categoryName,
      notice: decision === "accept" ? "category-accepted" : "category-rejected",
      result,
    }),
  );
}

export async function keepOnlyCategoryAction(
  formData: FormData,
): Promise<void> {
  const actorId = await currentUserId();
  if (!actorId) redirect("/login");
  const restaurantId = formString(formData, "restaurantId");
  const importId = formString(formData, "importId");
  const categoryName = formString(formData, "categoryName");

  let result: ImportCategoryDecisionResult;
  try {
    result = await keepOnlyImportCategory(
      getDb(),
      actorId,
      importId,
      categoryName,
    );
  } catch {
    redirect(
      categoryReviewUrl({
        restaurantId,
        importId,
        categoryName,
        error: "category",
      }),
    );
  }

  revalidateImportPaths(restaurantId, importId);
  redirect(
    categoryReviewUrl({
      restaurantId,
      importId,
      categoryName: result.categoryName,
      notice: "keep-only",
      result,
    }),
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
