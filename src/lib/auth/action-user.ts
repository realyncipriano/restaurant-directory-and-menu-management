import "server-only";

import { getDb } from "@/db/client";
import { getCurrentUser } from "./session";

export async function getActionUserId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.id ?? null;
}

export async function getActionAdminId(): Promise<string | null> {
  const user = await getCurrentUser(getDb());
  return user?.role === "admin" ? user.id : null;
}
