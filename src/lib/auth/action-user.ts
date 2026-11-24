import "server-only";

import { getDb } from "@/db/client";
import { isMfaRequiredForAdmins } from "@/lib/env";
import { getCurrentUser } from "./session";

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
