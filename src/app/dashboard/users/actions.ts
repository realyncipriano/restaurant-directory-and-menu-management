"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formStateFromError } from "@/lib/action-error";
import {
  formString,
  type InviteFormState,
} from "@/lib/action-state";
import {
  deactivateErrorCode,
  reactivateErrorCode,
  roleErrorCode,
} from "@/lib/admin-user-notices";
import { getActionAdminId } from "@/lib/auth/action-user";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizeUuid } from "@/lib/validation/ids";
import {
  createInvite,
  createPasswordResetLink,
  deactivateUser,
  reactivateUser,
  setUserRole,
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

  const userId = normalizeUuid(formString(formData, "userId"));
  if (!userId) {
    return { error: "User not found." };
  }

  try {
    const link = await createPasswordResetLink(getDb(), {
      actorId: adminId,
      userId,
    });
    return {
      success: "Reset link created. It expires in one hour.",
      inviteUrl: link.url,
    };
  } catch (error) {
    return { error: formStateFromError(error).error };
  }
}

function normalizedUserId(formData: FormData): string {
  const userId = normalizeUuid(formString(formData, "userId"));
  if (!userId) {
    redirect("/dashboard/users?error=user_invalid");
  }
  return userId;
}

export async function setUserRoleAction(
  formData: FormData,
): Promise<void> {
  const adminId = await getActionAdminId();
  if (!adminId) redirect("/dashboard");

  const userId = normalizedUserId(formData);
  const role = formString(formData, "role");
  let changed = true;

  try {
    const result = await setUserRole(getDb(), {
      actorId: adminId,
      userId,
      role,
    });
    changed = result.changed;
  } catch (error) {
    if (error instanceof ConflictError) {
      redirect(`/dashboard/users?error=${roleErrorCode(error.reason)}`);
    }
    if (error instanceof ValidationError) {
      redirect("/dashboard/users?error=role_invalid");
    }
    if (error instanceof NotFoundError) {
      redirect("/dashboard/users?error=user_missing");
    }
    redirect("/dashboard/users?error=failed");
  }

  revalidatePath("/dashboard/users");
  if (!changed) {
    redirect("/dashboard/users?notice=role_unchanged");
  }
  redirect(
    `/dashboard/users?notice=${role === "admin" ? "promoted" : "demoted"}`,
  );
}

export async function deactivateUserAction(
  formData: FormData,
): Promise<void> {
  const adminId = await getActionAdminId();
  if (!adminId) redirect("/dashboard");

  const userId = normalizedUserId(formData);
  let changed = true;

  try {
    const result = await deactivateUser(getDb(), {
      actorId: adminId,
      userId,
    });
    changed = result.changed;
  } catch (error) {
    if (error instanceof ConflictError) {
      redirect(`/dashboard/users?error=${deactivateErrorCode(error.reason)}`);
    }
    if (error instanceof NotFoundError) {
      redirect("/dashboard/users?error=user_missing");
    }
    redirect("/dashboard/users?error=failed");
  }

  revalidatePath("/dashboard/users");
  if (!changed) {
    redirect("/dashboard/users?notice=deactivated_unchanged");
  }
  redirect("/dashboard/users?notice=deactivated");
}

export async function reactivateUserAction(
  formData: FormData,
): Promise<void> {
  const adminId = await getActionAdminId();
  if (!adminId) redirect("/dashboard");

  const userId = normalizedUserId(formData);

  try {
    await reactivateUser(getDb(), {
      actorId: adminId,
      userId,
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      redirect(`/dashboard/users?error=${reactivateErrorCode(error.reason)}`);
    }
    if (error instanceof NotFoundError) {
      redirect("/dashboard/users?error=user_missing");
    }
    redirect("/dashboard/users?error=failed");
  }

  revalidatePath("/dashboard/users");
  redirect("/dashboard/users?notice=reactivated");
}
