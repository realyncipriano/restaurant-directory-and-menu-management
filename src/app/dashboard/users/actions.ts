"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  formString,
  type InviteFormState,
} from "@/lib/action-state";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  createInvite,
  createPasswordResetLink,
  deactivateUser,
  reactivateUser,
} from "@/server/services/auth";

async function requireAdminId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.role === "admin" ? user.id : null;
}

function messageFor(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  if (error instanceof ConflictError || error instanceof NotFoundError) {
    return error.message;
  }
  if (error instanceof AppError) return error.message;
  return "Something went wrong. Please try again.";
}

export async function createInviteAction(
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const adminId = await requireAdminId();
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
    return {
      error: messageFor(error),
      fieldErrors:
        error instanceof ValidationError ? error.fieldErrors : undefined,
    };
  }
}

export async function createResetLinkAction(
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const adminId = await requireAdminId();
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
    return { error: messageFor(error) };
  }
}

export async function deactivateUserAction(
  formData: FormData,
): Promise<void> {
  const adminId = await requireAdminId();
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
  const adminId = await requireAdminId();
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
