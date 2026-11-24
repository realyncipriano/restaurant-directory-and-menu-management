"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { formString } from "@/lib/action-state";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth/session";
import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import { normalizeUuid } from "@/lib/validation/ids";
import { revokeUserSession } from "@/server/services/auth";

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser(getDb());
  if (!user) redirect("/login");

  const sessionId = normalizeUuid(formString(formData, "sessionId"));
  if (!sessionId) {
    redirect("/dashboard/account?error=session_invalid");
  }

  let currentSession = false;
  try {
    const result = await revokeUserSession(getDb(), {
      actorId: user.id,
      sessionId,
      currentSessionId: user.sessionId,
    });
    currentSession = result.currentSession;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    if (error instanceof NotFoundError) {
      redirect("/dashboard/account?error=session_missing");
    }
    redirect("/dashboard/account?error=failed");
  }

  if (currentSession) {
    await clearSessionCookie();
    redirect("/login");
  }

  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?notice=session_revoked");
}
