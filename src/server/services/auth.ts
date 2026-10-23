import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import {
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  CHANGE_PASSWORD_LIMIT,
  CHANGE_PASSWORD_WINDOW_SECONDS,
  LOGIN_ACCOUNT_GLOBAL_LIMIT,
  LOGIN_ACCOUNT_GLOBAL_WINDOW_SECONDS,
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_WINDOW_SECONDS,
  consumeRateLimit,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import { createSession, revokeAllUserSessions } from "@/lib/auth/session";
import { hashIdentifier } from "@/lib/auth/tokens";
import {
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { parseOrThrow } from "@/lib/validation/parse";
import {
  activateSchema,
  changePasswordSchema,
  inviteSchema,
  loginSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { writeAuditLog } from "./audit";
import { requireActiveActor, requireAdminActor } from "./auth/actors";
import { enforceActivationRateLimit } from "./auth/limits";
import {
  INVITE_TTL_MS,
  RESET_TTL_MS,
  activationUrl,
  addMs,
  assertStrongPassword,
  publicUser,
  type AuthResult,
  type PublicUser,
  type SessionMeta,
} from "./auth/shared";
import {
  findUsableToken,
  invalidateUserTokens,
  issueToken,
  markTokenUsed,
} from "./auth/token-store";

export { requireActiveActor, requireAdminActor } from "./auth/actors";
export type { AuthResult, PublicUser } from "./auth/shared";

export async function loginWithPassword(
  db: DbClient,
  input: {
    email: string;
    password: string;
    ipHash?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<AuthResult> {
  const now = input.now ?? new Date();
  const parsed = parseOrThrow(loginSchema, {
    email: input.email,
    password: input.password,
  });

  const emailHash = hashIdentifier(parsed.email);
  const accountKey = input.ipHash
    ? `login-account:${emailHash}:${input.ipHash}`
    : `login-account:${emailHash}`;
  const accountLimit = await consumeRateLimit(db, {
    key: accountKey,
    limit: LOGIN_ACCOUNT_LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    now,
  });
  if (!accountLimit.allowed) {
    throw new RateLimitedError(accountLimit.retryAfterSeconds);
  }

  const globalAccountLimit = await consumeRateLimit(db, {
    key: `login-account-global:${emailHash}`,
    limit: LOGIN_ACCOUNT_GLOBAL_LIMIT,
    windowSeconds: LOGIN_ACCOUNT_GLOBAL_WINDOW_SECONDS,
    now,
  });
  if (!globalAccountLimit.allowed) {
    throw new RateLimitedError(globalAccountLimit.retryAfterSeconds);
  }

  if (input.ipHash) {
    const ipLimit = await consumeRateLimit(db, {
      key: `login-ip:${input.ipHash}`,
      limit: LOGIN_IP_LIMIT,
      windowSeconds: LOGIN_WINDOW_SECONDS,
      now,
    });
    if (!ipLimit.allowed) {
      throw new RateLimitedError(ipLimit.retryAfterSeconds);
    }
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${parsed.email}`)
    .limit(1);

  if (!user?.passwordHash) {
    await verifyDummyPassword(parsed.password);
    throw new InvalidCredentialsError();
  }

  const passwordValid = await verifyPassword(user.passwordHash, parsed.password);
  if (!passwordValid || user.accountStatus !== "active") {
    throw new InvalidCredentialsError();
  }

  await resetRateLimit(db, accountKey);

  await db
    .update(users)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(users.id, user.id));

  const session = await createSession(
    db,
    user.id,
    { ipHash: input.ipHash, userAgent: input.userAgent },
    now,
  );

  await writeAuditLog(db, {
    actor: { id: user.id, email: user.email },
    action: "user_login",
    entityType: "session",
    entityId: user.id,
    details: { role: user.role },
  });

  return { user: publicUser(user), session };
}

export async function getActivationContext(
  db: DbClient,
  rawToken: string,
  now = new Date(),
): Promise<{
  kind: "invite" | "password_reset";
  email: string;
  name: string;
  expiresAt: Date;
} | null> {
  const row = await findUsableToken(
    db,
    rawToken,
    ["invite", "password_reset"],
    now,
  );
  if (!row) return null;

  return {
    kind: row.purpose,
    email: row.email,
    name: row.name,
    expiresAt: row.expiresAt,
  };
}

export async function activateAccount(
  db: DbClient,
  input: {
    token: string;
    name: string;
    password: string;
    confirmPassword: string;
    ipHash?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<AuthResult> {
  const now = input.now ?? new Date();
  const parsed = parseOrThrow(activateSchema, input);
  assertStrongPassword(parsed.password);
  await enforceActivationRateLimit(db, input.ipHash, now);

  const context = await findUsableToken(db, parsed.token, ["invite"], now);
  if (!context) {
    throw new NotFoundError("This invitation link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(parsed.password);
  const sessionMeta: SessionMeta = {
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  };

  return db.transaction(async (tx) => {
    const marked = await markTokenUsed(tx, context.tokenId, now);
    if (!marked) {
      throw new ConflictError("This invitation has already been used.");
    }

    const [updated] = await tx
      .update(users)
      .set({
        name: parsed.name,
        passwordHash,
        accountStatus: "active",
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, context.userId),
          eq(users.accountStatus, "invited"),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictError("This invitation can no longer be activated.");
    }

    await invalidateUserTokens(tx, context.userId, now);
    await revokeAllUserSessions(tx, context.userId, now);
    const session = await createSession(tx, updated.id, sessionMeta, now);

    await writeAuditLog(tx, {
      actor: { id: updated.id, email: updated.email },
      action: "user_activated",
      entityType: "user",
      entityId: updated.id,
      details: { role: updated.role },
    });

    return { user: publicUser(updated), session };
  });
}

export async function resetPasswordWithToken(
  db: DbClient,
  input: {
    token: string;
    password: string;
    confirmPassword: string;
    ipHash?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<AuthResult> {
  const now = input.now ?? new Date();
  const parsed = parseOrThrow(resetPasswordSchema, input);
  assertStrongPassword(parsed.password);
  await enforceActivationRateLimit(db, input.ipHash, now);

  const context = await findUsableToken(
    db,
    parsed.token,
    ["password_reset"],
    now,
  );
  if (!context) {
    throw new NotFoundError(
      "This password reset link is invalid or has expired.",
    );
  }

  const passwordHash = await hashPassword(parsed.password);
  const sessionMeta: SessionMeta = {
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  };

  return db.transaction(async (tx) => {
    const marked = await markTokenUsed(tx, context.tokenId, now);
    if (!marked) {
      throw new ConflictError("This reset link has already been used.");
    }

    const [updated] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(
        and(eq(users.id, context.userId), eq(users.accountStatus, "active")),
      )
      .returning();

    if (!updated) {
      throw new ConflictError("This account can no longer be reset.");
    }

    await invalidateUserTokens(tx, context.userId, now);
    await revokeAllUserSessions(tx, context.userId, now);
    const session = await createSession(tx, updated.id, sessionMeta, now);

    await writeAuditLog(tx, {
      actor: { id: updated.id, email: updated.email },
      action: "password_reset",
      entityType: "user",
      entityId: updated.id,
    });

    return { user: publicUser(updated), session };
  });
}

export async function changePassword(
  db: DbClient,
  input: {
    actorId: string;
    currentPassword: string;
    password: string;
    confirmPassword: string;
    ipHash?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<AuthResult> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  if (!actor.passwordHash) {
    throw new UnauthenticatedError();
  }

  const parsed = parseOrThrow(changePasswordSchema, input);
  assertStrongPassword(parsed.password);

  const changePasswordKey = `change-password:${actor.id}:${input.ipHash ?? "unknown"}`;
  const changePasswordLimit = await consumeRateLimit(db, {
    key: changePasswordKey,
    limit: CHANGE_PASSWORD_LIMIT,
    windowSeconds: CHANGE_PASSWORD_WINDOW_SECONDS,
    now,
  });
  if (!changePasswordLimit.allowed) {
    throw new RateLimitedError(changePasswordLimit.retryAfterSeconds);
  }

  const valid = await verifyPassword(actor.passwordHash, parsed.currentPassword);
  if (!valid) {
    throw new ValidationError("Current password is incorrect.", {
      currentPassword: ["Current password is incorrect."],
    });
  }

  if (parsed.currentPassword === parsed.password) {
    throw new ValidationError("Choose a different password.", {
      password: ["New password must be different from the current password."],
    });
  }

  const passwordHash = await hashPassword(parsed.password);
  const sessionMeta: SessionMeta = {
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  };

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, actor.id))
      .returning();

    if (!updated) {
      throw new ConflictError("This account no longer exists.");
    }

    await revokeAllUserSessions(tx, actor.id, now);
    await invalidateUserTokens(tx, actor.id, now);
    const session = await createSession(tx, actor.id, sessionMeta, now);

    await writeAuditLog(tx, {
      actor: { id: updated.id, email: updated.email },
      action: "password_changed",
      entityType: "user",
      entityId: updated.id,
    });

    return { user: publicUser(updated), session };
  });

  await resetRateLimit(db, changePasswordKey);
  return result;
}

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
