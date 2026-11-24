"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formString, type FormState } from "@/lib/action-state";
import { requireCurrentUser } from "@/lib/auth/guards";
import { safeStepUpNext } from "@/lib/auth/step-up";
import {
  InvalidMfaCodeError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { verifyStepUp } from "@/server/services/auth";

export async function stepUpAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireCurrentUser("/dashboard/step-up");
  const next = safeStepUpNext(formString(formData, "next"));

  try {
    await verifyStepUp(getDb(), {
      actorId: user.id,
      sessionId: user.sessionId,
      password: formString(formData, "password"),
      code: formString(formData, "code"),
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return { error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof InvalidMfaCodeError) {
      return {
        error: error.message,
        fieldErrors: { code: [error.message] },
      };
    }
    if (error instanceof RateLimitedError) {
      return { error: error.message };
    }
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    return { error: "Something went wrong. Please try again." };
  }

  redirect(next);
}
