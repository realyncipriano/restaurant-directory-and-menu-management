import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  CHANGE_PASSWORD_LIMIT,
  CHANGE_PASSWORD_WINDOW_SECONDS,
  consumeRateLimit,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import { createSession, revokeAllUserSessions } from "@/lib/auth/session";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import {
  changePasswordSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "../audit";
import { requireActiveActor } from "./actors";
import { enforceActivationRateLimit } from "./limits";
import {
  assertStrongPassword,
  publicUser,
  type AuthResult,
  type SessionMeta,
} from "./shared";
import {
  findUsableToken,
  invalidateUserTokens,
  markTokenUsed,
} from "./token-store";

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
