import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import type { UserRow } from "./shared";

export async function requireActiveActor(
  db: DbExecutor,
  actorId: string,
): Promise<UserRow> {
  const [actor] = await db
    .select()
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor || actor.accountStatus !== "active") {
    throw new UnauthenticatedError();
  }
  return actor;
}

export async function requireAdminActor(
  db: DbExecutor,
  actorId: string,
): Promise<UserRow> {
  const actor = await requireActiveActor(db, actorId);
  if (actor.role !== "admin") {
    throw new ForbiddenError();
  }
  return actor;
}
