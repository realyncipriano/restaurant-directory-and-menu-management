"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formStateFromError } from "@/lib/action-error";
import {
  formString,
  type InviteFormState,
} from "@/lib/action-state";
import { getActionAdminId } from "@/lib/auth/action-user";
import { ConflictError } from "@/lib/errors";
import {
  createInvite,
  createPasswordResetLink,
  deactivateUser,
  reactivateUser,
} from "@/server/services/auth";

export async function createInviteAction(
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const adminId = await getActionAdminId();
  if (!adminId) {
    return { error: "You do not have permission to invite users." };
  }

  try {
    const invite = await createInvite(getDb(), {
      actorId: adminId,
      email: formString(formData, "email"),
      name: formString(formData, "name") || undefined,
    });
    revalidatePath("/dashboard/users");
    return {
      success: "Invitation created. Share the link below.",
      inviteUrl: invite.url,
      inviteEmail: invite.user.email,
    };
  } catch (error) {
    return formStateFromError(error);
  }
}

export async function createResetLinkAction(
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const adminId = await getActionAdminId();
  if (!adminId) {
    return { error: "You do not have permission to reset passwords." };
  }

  try {
    const link = await createPasswordResetLink(getDb(), {
      actorId: adminId,
      userId: formString(formData, "userId"),
    });
    return {
      success: "Reset link created. It expires in one hour.",
      inviteUrl: link.url,
    };
  } catch (error) {
    return { error: formStateFromError(error).error };
  }
}

export async function deactivateUserAction(
  formData: FormData,
): Promise<void> {
  const adminId = await getActionAdminId();
  if (!adminId) redirect("/dashboard");

  try {
    await deactivateUser(getDb(), {
      actorId: adminId,
      userId: formString(formData, "userId"),
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      redirect("/dashboard/users?error=conflict");
    }
    redirect("/dashboard/users?error=failed");
  }

  revalidatePath("/dashboard/users");
  redirect("/dashboard/users?notice=deactivated");
}

export async function reactivateUserAction(
  formData: FormData,
): Promise<void> {
  const adminId = await getActionAdminId();
  if (!adminId) redirect("/dashboard");

  try {
    await reactivateUser(getDb(), {
      actorId: adminId,
      userId: formString(formData, "userId"),
    });
  } catch {
    redirect("/dashboard/users?error=failed");
  }

  revalidatePath("/dashboard/users");
  redirect("/dashboard/users?notice=reactivated");
}
