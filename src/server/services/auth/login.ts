import { eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { users } from "@/db/schema";
import { verifyDummyPassword, verifyPassword } from "@/lib/auth/password";
import {
  LOGIN_ACCOUNT_GLOBAL_LIMIT,
  LOGIN_ACCOUNT_GLOBAL_WINDOW_SECONDS,
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_WINDOW_SECONDS,
  consumeRateLimit,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";
import { hashIdentifier } from "@/lib/auth/tokens";
import { InvalidCredentialsError, RateLimitedError } from "@/lib/errors";
import { loginSchema } from "@/lib/validation/auth";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "../audit";
import { publicUser, type AuthResult } from "./shared";

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
