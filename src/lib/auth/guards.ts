import "server-only";

import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { getCurrentUser, type SessionUser } from "./session";

export async function requireCurrentUser(
  nextPath = "/dashboard",
): Promise<SessionUser> {
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
  return user;
}
