"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formStateFromError } from "@/lib/action-error";
import { formString, type FormState } from "@/lib/action-state";
import { getActionAdminId } from "@/lib/auth/action-user";
import { ForbiddenError } from "@/lib/errors";
import { updateAppSettings } from "@/server/services/app-settings";

export async function updateSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const adminId = await getActionAdminId();
  if (!adminId) {
    return formStateFromError(new ForbiddenError());
  }

  try {
    await updateAppSettings(getDb(), adminId, {
      siteName: formString(formData, "siteName"),
      siteTagline: formString(formData, "siteTagline"),
      supportEmail: formString(formData, "supportEmail"),
    });
  } catch (error) {
    return formStateFromError(error);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard/settings?notice=saved");
}
