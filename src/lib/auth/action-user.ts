import "server-only";

import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { isMfaRequiredForAdmins } from "@/lib/env";
import { getCurrentUser } from "./session";
import { isStepUpFresh } from "./step-up";

export async function getActionUserId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.id ?? null;
}

export async function getActionAdminId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  if (!user || user.role !== "admin") return null;
  if (isMfaRequiredForAdmins() && !user.mfaEnabled) return null;
  return user.id;
}

/**
 * Sensitive administrator actions call this variant. A stale step-up redirects
 * to the verification page instead of returning a permission error.
 */
export async function getActionAdminIdWithStepUp(
  nextPath: string,
): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  if (!user || user.role !== "admin") return null;
  if (isMfaRequiredForAdmins() && !user.mfaEnabled) return null;
  if (!isStepUpFresh(user.steppedUpAt)) {
    redirect(`/dashboard/step-up?next=${encodeURIComponent(nextPath)}`);
  }
  return user.id;
}
