import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getDb } from "@/db/client";
import { isMfaRequiredForAdmins } from "@/lib/env";
import { getCurrentUser, type SessionUser } from "./session";
import { isStepUpFresh } from "./step-up";

export async function requireCurrentUser(
  nextPath = "/dashboard",
): Promise<SessionUser> {
  await connection();
  const user = await getCurrentUser(getDb());
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}

export async function requireAdminUser(): Promise<SessionUser> {
  const user = await requireCurrentUser();
  if (user.role !== "admin") {
    redirect("/dashboard");
  }
  if (isMfaRequiredForAdmins() && !user.mfaEnabled) {
    redirect("/dashboard/account?mfa=required");
  }
  return user;
}

export function requireFreshStepUp(
  user: SessionUser,
  nextPath: string,
): SessionUser {
  if (!isStepUpFresh(user.steppedUpAt)) {
    redirect(`/dashboard/step-up?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}
