import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation/parse";
import { inviteSchema } from "@/lib/validation/auth";
import { writeAuditLog } from "./audit";
import { requireAdminActor } from "./auth/actors";
import {
  INVITE_TTL_MS,
  RESET_TTL_MS,
  activationUrl,
  addMs,
  publicUser,
  type PublicUser,
} from "./auth/shared";
import { invalidateUserTokens, issueToken } from "./auth/token-store";

export {
  activateAccount,
  getActivationContext,
} from "./auth/activation";
export { requireActiveActor, requireAdminActor } from "./auth/actors";
export { loginWithPassword } from "./auth/login";
export {
  changePassword,
  resetPasswordWithToken,
} from "./auth/passwords";
export type { AuthResult, PublicUser } from "./auth/shared";

export async function createInvite(
  db: DbClient,
  input: {
    actorId: string;
    email: string;
    name?: string;
    now?: Date;
  },
): Promise<{ token: string; url: string; user: PublicUser }> {
  const now = input.now ?? new Date();
  const actor = await requireAdminActor(db, input.actorId);
  const parsed = parseOrThrow(inviteSchema, {
    email: input.email,
    name: input.name,
  });

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${parsed.email}`)
    .limit(1);

  if (existing) {
    const canRenewInvite =
      existing.role === "authorized_user" &&
      (existing.accountStatus === "invited" ||
        (existing.accountStatus === "deactivated" && !existing.passwordHash));
    if (!canRenewInvite) {
      throw new ConflictError("An account with that email already exists.");
    }

    const [renewed] = await db
      .update(users)
      .set({
        name: parsed.name ?? existing.name,
        accountStatus: "invited",
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning();

    await invalidateUserTokens(db, existing.id, now);
    const token = await issueToken(db, {
      userId: existing.id,
      purpose: "invite",
      createdBy: actor.id,
      expiresAt: addMs(now, INVITE_TTL_MS),
      now,
    });

    await writeAuditLog(db, {
      actor: { id: actor.id, email: actor.email },
      action: "user_invited",
      entityType: "user",
      entityId: existing.id,
      details: { email: existing.email, renewed: true },
    });

    return {
      token,
      url: activationUrl(token),
      user: publicUser(renewed ?? existing),
    };
  }

  const fallbackName = parsed.email.split("@")[0] || "Team member";

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        name: parsed.name ?? fallbackName,
        email: parsed.email,
        role: "authorized_user",
        accountStatus: "invited",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const token = await issueToken(tx, {
      userId: user.id,
      purpose: "invite",
      createdBy: actor.id,
      expiresAt: addMs(now, INVITE_TTL_MS),
      now,
    });

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "user_invited",
      entityType: "user",
      entityId: user.id,
      details: { email: user.email, renewed: false },
    });

    return { user, token };
  });

  return {
    token: created.token,
    url: activationUrl(created.token),
    user: publicUser(created.user),
  };
}

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
