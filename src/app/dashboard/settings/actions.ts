"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formString, type FormState } from "@/lib/action-state";
import { getCurrentUser } from "@/lib/auth/session";
import {
  AppError,
  ForbiddenError,
  ValidationError,
} from "@/lib/errors";
import { updateAppSettings } from "@/server/services/app-settings";

function messageFor(error: unknown): FormState {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof AppError) {
    return { error: error.message };
  }
  return { error: "Something went wrong. Please try again." };
}

async function currentAdminId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.role === "admin" ? user.id : null;
}

export async function updateSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const adminId = await currentAdminId();
  if (!adminId) {
    return messageFor(new ForbiddenError());
  }

  try {
    await updateAppSettings(getDb(), adminId, {
      siteName: formString(formData, "siteName"),
      siteTagline: formString(formData, "siteTagline"),
      supportEmail: formString(formData, "supportEmail"),
    });
  } catch (error) {
    return messageFor(error);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard/settings?notice=saved");
}
