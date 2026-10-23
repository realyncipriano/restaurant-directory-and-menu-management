import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "../audit";
import { requireAdminActor } from "./actors";
import {
  RESET_TTL_MS,
  activationUrl,
  addMs,
  publicUser,
  type PublicUser,
} from "./shared";
import { invalidateUserTokens, issueToken } from "./token-store";

export async function createPasswordResetLink(
  db: DbClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<{ token: string; url: string }> {
  const now = input.now ?? new Date();
  const actor = await requireAdminActor(db, input.actorId);

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError("User not found.");
  }
  if (target.accountStatus !== "active" || !target.passwordHash) {
    throw new ConflictError(
      "This account is not active. Send a new invitation instead.",
    );
  }

  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.userId, target.id),
        eq(authTokens.purpose, "password_reset"),
        isNull(authTokens.usedAt),
      ),
    );

  const token = await issueToken(db, {
    userId: target.id,
    purpose: "password_reset",
    createdBy: actor.id,
    expiresAt: addMs(now, RESET_TTL_MS),
    now,
  });

  await writeAuditLog(db, {
    actor: { id: actor.id, email: actor.email },
    action: "password_reset_link_created",
    entityType: "user",
    entityId: target.id,
    details: { email: target.email },
  });

  return { token, url: activationUrl(token) };
}

export async function deactivateUser(
  db: DbClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const actor = await requireAdminActor(db, input.actorId);

  if (actor.id === input.userId) {
    throw new ConflictError("You cannot deactivate your own account.");
  }

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);

    if (!target) {
      throw new NotFoundError("User not found.");
    }
    if (target.accountStatus === "deactivated") {
      return;
    }

    if (target.role === "admin") {
      await tx.execute(
        sql`select id from ${users} where ${users.role} = 'admin' and ${users.accountStatus} = 'active' for update`,
      );
      const [row] = await tx
        .select({ total: count() })
        .from(users)
        .where(
          and(eq(users.role, "admin"), eq(users.accountStatus, "active")),
        );
      if ((row?.total ?? 0) <= 1) {
        throw new ConflictError(
          "At least one active administrator is required.",
        );
      }
    }

    const [updated] = await tx
      .update(users)
      .set({ accountStatus: "deactivated", updatedAt: now })
      .where(
        and(
          eq(users.id, target.id),
          inArray(users.accountStatus, ["active", "invited"]),
        ),
      )
      .returning({ id: users.id });
    if (!updated) {
      throw new ConflictError("This account is no longer active.");
    }

    await revokeAllUserSessions(tx, target.id, now);
    await invalidateUserTokens(tx, target.id, now);
    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "user_deactivated",
      entityType: "user",
      entityId: target.id,
      details: { email: target.email },
    });
  });
}

export async function reactivateUser(
  db: DbClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const actor = await requireAdminActor(db, input.actorId);

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError("User not found.");
  }
  if (target.accountStatus !== "deactivated") {
    throw new ConflictError("This account is not deactivated.");
  }
  if (!target.passwordHash) {
    throw new ConflictError("Send a new invitation instead.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ accountStatus: "active", updatedAt: now })
      .where(eq(users.id, target.id));
    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "user_reactivated",
      entityType: "user",
      entityId: target.id,
      details: { email: target.email },
    });
  });
}

export async function listUsers(
  db: DbClient,
  actorId: string,
): Promise<PublicUser[]> {
  await requireAdminActor(db, actorId);
  const rows = await db
    .select()
    .from(users)
    .orderBy(users.createdAt);
  return rows.map(publicUser);
}
