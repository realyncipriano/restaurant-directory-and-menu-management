import { eq, sql } from "drizzle-orm";

import type { DbTransaction } from "@/db/client";
import { users } from "@/db/schema";
import { isMfaRequiredForAdmins } from "@/lib/env";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";

/**
 * All administrator membership changes share this transaction-level lock.
 * It serializes demotions and deactivations so two concurrent requests can
 * never remove the final active administrator, and avoids row-lock deadlocks
 * when administrators act on each other.
 */
export const ADMIN_MEMBERSHIP_LOCK_KEY = "rdmm.admin-membership";

export async function lockAdminMembership(tx: DbTransaction): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${ADMIN_MEMBERSHIP_LOCK_KEY}))`,
  );
}

export async function requireAdminActorForUpdate(
  tx: DbTransaction,
  actorId: string,
): Promise<typeof users.$inferSelect> {
  const [actor] = await tx
    .select()
    .from(users)
    .where(eq(users.id, actorId))
    .for("update")
    .limit(1);

  if (!actor || actor.accountStatus !== "active") {
    throw new UnauthenticatedError();
  }
  if (actor.role !== "admin") {
    throw new ForbiddenError();
  }
  if (isMfaRequiredForAdmins() && !actor.mfaEnabledAt) {
    throw new ForbiddenError(
      "Multi-factor authentication is required for administrator actions.",
    );
  }
  return actor;
}
