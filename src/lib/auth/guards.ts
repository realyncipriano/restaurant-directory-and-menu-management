import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getDb } from "@/db/client";
import { getCurrentUser, type SessionUser } from "./session";

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
  return user;
}
