"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import {
  clearMfaChallengeCookie,
  clearSessionCookie,
  getCurrentUser,
  readMfaChallengeToken,
  readSessionToken,
  setMfaChallengeCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import { formString, safeRedirectPath, type FormState } from "@/lib/action-state";
import {
  InvalidMfaCodeError,
  MfaChallengeInvalidError,
  MfaChallengeRequiredError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import {
  activateAccount,
  changePassword,
  completeMfaChallenge,
  loginWithPassword,
  resetPasswordWithToken,
  signOutAllSessions,
  signOutCurrentSession,
} from "@/server/services/auth";

function toFormState(error: unknown): FormState {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof RateLimitedError) {
    return { error: error.message };
  }
  if (
    error instanceof InvalidMfaCodeError ||
    error instanceof MfaChallengeInvalidError
  ) {
    return { error: error.message };
  }
  return { error: "Something went wrong. Please try again." };
}

export async function loginAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const meta = await getRequestMeta();
  let result;
  try {
    result = await loginWithPassword(getDb(), {
      email: formString(formData, "email"),
      password: formString(formData, "password"),
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
  } catch (error) {
    if (error instanceof MfaChallengeRequiredError) {
      await setMfaChallengeCookie(
        error.challenge.token,
        error.challenge.expiresAt,
      );
      redirect(
        `/login/mfa?next=${encodeURIComponent(
          safeRedirectPath(formString(formData, "next")),
        )}`,
      );
    }
    return toFormState(error);
  }

  await clearMfaChallengeCookie();
  await setSessionCookie(result.session.token, result.session.expiresAt);
  redirect(safeRedirectPath(formString(formData, "next")));
}

export async function mfaLoginAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const meta = await getRequestMeta();
  const challengeToken = await readMfaChallengeToken();

  let result;
  try {
    result = await completeMfaChallenge(getDb(), {
      challengeToken: challengeToken ?? "",
      code: formString(formData, "code"),
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
  } catch (error) {
    if (error instanceof MfaChallengeInvalidError) {
      await clearMfaChallengeCookie();
    }
    return toFormState(error);
  }

  await clearMfaChallengeCookie();
  await setSessionCookie(result.session.token, result.session.expiresAt);
  redirect(safeRedirectPath(formString(formData, "next")));
}

export async function activateAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const meta = await getRequestMeta();
  const kind = formString(formData, "kind");
  const token = formString(formData, "token");

  let result;
  try {
    if (kind === "reset") {
      result = await resetPasswordWithToken(getDb(), {
        token,
        password: formString(formData, "password"),
        confirmPassword: formString(formData, "confirmPassword"),
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
      });
    } else {
      result = await activateAccount(getDb(), {
        token,
        name: formString(formData, "name"),
        password: formString(formData, "password"),
        confirmPassword: formString(formData, "confirmPassword"),
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
      });
    }
  } catch (error) {
    if (error instanceof MfaChallengeRequiredError) {
      await setMfaChallengeCookie(
        error.challenge.token,
        error.challenge.expiresAt,
      );
      redirect(
        `/login/mfa?next=${encodeURIComponent("/dashboard")}&notice=${
          kind === "reset" ? "password_reset" : "account_activated"
        }`,
      );
    }
    return toFormState(error);
  }

  await clearMfaChallengeCookie();
  await setSessionCookie(result.session.token, result.session.expiresAt);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  await signOutCurrentSession(getDb(), token);
  await clearMfaChallengeCookie();
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser(getDb());
  if (!user) {
    redirect("/login");
  }

  const meta = await getRequestMeta();
  try {
    const result = await changePassword(getDb(), {
      actorId: user.id,
      currentPassword: formString(formData, "currentPassword"),
      password: formString(formData, "password"),
      confirmPassword: formString(formData, "confirmPassword"),
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
    await setSessionCookie(result.session.token, result.session.expiresAt);
  } catch (error) {
    return toFormState(error);
  }

  redirect("/dashboard/account?updated=1");
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await getCurrentUser(getDb());
  if (user) {
    await signOutAllSessions(getDb(), user.id);
  }
  await clearMfaChallengeCookie();
  await clearSessionCookie();
  redirect("/login");
}
