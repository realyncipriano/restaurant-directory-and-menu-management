"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formString, type MfaFormState } from "@/lib/action-state";
import { getCurrentUser } from "@/lib/auth/session";
import {
  ConflictError,
  InvalidMfaCodeError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import {
  beginMfaEnrollment,
  cancelMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  regenerateRecoveryCodes,
} from "@/server/services/auth";

function toMfaFormState(error: unknown): MfaFormState {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof InvalidMfaCodeError) {
    return {
      error: error.message,
      fieldErrors: { code: [error.message] },
    };
  }
  if (error instanceof RateLimitedError || error instanceof ConflictError) {
    return { error: error.message };
  }
  return { error: "Something went wrong. Please try again." };
}

async function requireAccountUser() {
  const user = await getCurrentUser(getDb());
  if (!user) redirect("/login");
  return user;
}

export async function beginMfaEnrollmentAction(): Promise<void> {
  const user = await requireAccountUser();

  try {
    await beginMfaEnrollment(getDb(), { actorId: user.id });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      redirect("/dashboard/account?error=mfa_rate_limited");
    }
    if (error instanceof ConflictError) {
      redirect("/dashboard/account?error=mfa_conflict");
    }
    redirect("/dashboard/account?error=mfa_failed");
  }

  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?mfa=setup");
}

export async function cancelMfaEnrollmentAction(): Promise<void> {
  const user = await requireAccountUser();

  try {
    await cancelMfaEnrollment(getDb(), { actorId: user.id });
  } catch (error) {
    if (error instanceof ConflictError) {
      redirect("/dashboard/account?error=mfa_conflict");
    }
    redirect("/dashboard/account?error=mfa_failed");
  }

  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?mfa=cancelled");
}

export async function confirmMfaEnrollmentAction(
  _prevState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const user = await requireAccountUser();

  try {
    const result = await confirmMfaEnrollment(getDb(), {
      actorId: user.id,
      code: formString(formData, "code"),
      currentSessionId: user.sessionId,
    });
    return { recoveryCodes: result.recoveryCodes };
  } catch (error) {
    return toMfaFormState(error);
  }
}

export async function regenerateRecoveryCodesAction(
  _prevState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const user = await requireAccountUser();

  try {
    const result = await regenerateRecoveryCodes(getDb(), {
      actorId: user.id,
      code: formString(formData, "code"),
    });
    return { recoveryCodes: result.recoveryCodes };
  } catch (error) {
    return toMfaFormState(error);
  }
}

export async function disableMfaAction(
  _prevState: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const user = await requireAccountUser();

  try {
    await disableMfa(getDb(), {
      actorId: user.id,
      password: formString(formData, "password"),
      code: formString(formData, "code"),
      currentSessionId: user.sessionId,
    });
  } catch (error) {
    return toMfaFormState(error);
  }

  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?mfa=disabled");
}
