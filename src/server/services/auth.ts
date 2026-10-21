import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { authTokens, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import {
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  ACTIVATION_IP_LIMIT,
  ACTIVATION_WINDOW_SECONDS,
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_WINDOW_SECONDS,
  consumeRateLimit,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import {
  createSession,
  revokeAllUserSessions,
  type CreatedSession,
} from "@/lib/auth/session";
import { hashIdentifier, hashToken, generateSecureToken } from "@/lib/auth/tokens";
import { getAppUrl } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
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
  validatePasswordStrength,
} from "@/lib/validation/auth";
import { writeAuditLog } from "./audit";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

type AuthTokenPurpose = "invite" | "password_reset";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "authorized_user";
  accountStatus: "invited" | "active" | "deactivated";
  lastLoginAt: Date | null;
};

export type AuthResult = {
  user: PublicUser;
  session: CreatedSession;
};

type SessionMeta = {
  ipHash?: string | null;
  userAgent?: string | null;
};

type UserRow = typeof users.$inferSelect;

function publicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    lastLoginAt: user.lastLoginAt,
  };
}

function activationUrl(token: string): string {
  return `${getAppUrl()}/activate?token=${encodeURIComponent(token)}`;
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function assertStrongPassword(password: string): void {
  const problem = validatePasswordStrength(password);
  if (problem) {
    throw new ValidationError(problem, { password: [problem] });
  }
}

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

async function findUsableToken(
  db: DbExecutor,
  rawToken: string,
  purposes: AuthTokenPurpose[],
  now: Date,
) {
  const token = rawToken.trim();
  if (token.length < 20 || token.length > 200) return null;

  const [row] = await db
    .select({
      tokenId: authTokens.id,
      purpose: authTokens.purpose,
      expiresAt: authTokens.expiresAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      accountStatus: users.accountStatus,
      passwordHash: users.passwordHash,
    })
    .from(authTokens)
    .innerJoin(users, eq(authTokens.userId, users.id))
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        inArray(authTokens.purpose, purposes),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (row.purpose === "invite" && row.accountStatus !== "invited") {
    return null;
  }
  if (row.purpose === "password_reset" && row.accountStatus !== "active") {
    return null;
  }

  return row;
}

async function markTokenUsed(
  db: DbExecutor,
  tokenId: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.id, tokenId), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id });
  return Boolean(row);
}

async function invalidateUserTokens(
  db: DbExecutor,
  userId: string,
  now: Date,
): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)));
}

async function issueToken(
  db: DbExecutor,
  input: {
    userId: string;
    purpose: AuthTokenPurpose;
    createdBy: string | null;
    expiresAt: Date;
    now: Date;
  },
): Promise<string> {
  const token = generateSecureToken();
  await db.insert(authTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: hashToken(token),
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
    createdAt: input.now,
  });
  return token;
}

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

  const accountKey = `login-account:${hashIdentifier(parsed.email)}:${input.ipHash ?? "unknown"}`;
  const accountLimit = await consumeRateLimit(db, {
    key: accountKey,
    limit: LOGIN_ACCOUNT_LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    now,
  });
  if (!accountLimit.allowed) {
    throw new RateLimitedError(accountLimit.retryAfterSeconds);
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

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, actor.id))
      .returning();

    if (!updated) {
      throw new ConflictError("This account no longer exists.");
    }

    await revokeAllUserSessions(tx, actor.id, now);
    const session = await createSession(tx, actor.id, sessionMeta, now);

    await writeAuditLog(tx, {
      actor: { id: updated.id, email: updated.email },
      action: "password_changed",
      entityType: "user",
      entityId: updated.id,
    });

    return { user: publicUser(updated), session };
  });
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
    if (
      existing.accountStatus !== "invited" ||
      existing.role !== "authorized_user"
    ) {
      throw new ConflictError("An account with that email already exists.");
    }

    if (parsed.name) {
      await db
        .update(users)
        .set({ name: parsed.name, updatedAt: now })
        .where(eq(users.id, existing.id));
    }

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
      user: publicUser(existing),
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

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError("User not found.");
  }
  if (target.accountStatus === "deactivated") {
    return;
  }

  if (target.role === "admin") {
    const [row] = await db
      .select({ total: count() })
      .from(users)
      .where(
        and(eq(users.role, "admin"), eq(users.accountStatus, "active")),
      );
    if ((row?.total ?? 0) <= 1) {
      throw new ConflictError("At least one active administrator is required.");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ accountStatus: "deactivated", updatedAt: now })
      .where(eq(users.id, target.id));
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

async function enforceActivationRateLimit(
  db: DbClient,
  ipHash: string | null | undefined,
  now: Date,
): Promise<void> {
  if (!ipHash) return;
  const result = await consumeRateLimit(db, {
    key: `activation-ip:${ipHash}`,
    limit: ACTIVATION_IP_LIMIT,
    windowSeconds: ACTIVATION_WINDOW_SECONDS,
    now,
  });
  if (!result.allowed) {
    throw new RateLimitedError(result.retryAfterSeconds);
  }
}
