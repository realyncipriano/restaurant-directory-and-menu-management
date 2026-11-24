import "server-only";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { cookies } from "next/headers";

import { sessions, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { logger } from "@/lib/observability/logger";
import {
  SESSION_COOKIE,
  SESSION_LAST_USED_THROTTLE_SECONDS,
  SESSION_TTL_SECONDS,
  getSessionIdleTtlSeconds,
} from "./constants";
import { generateSecureToken, hashToken } from "./tokens";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "authorized_user";
  accountStatus: "invited" | "active" | "deactivated";
  sessionId: string;
};

export type CreatedSession = {
  token: string;
  expiresAt: Date;
};

export async function createSession(
  db: DbExecutor,
  userId: string,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
  now = new Date(),
): Promise<CreatedSession> {
  const token = generateSecureToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    ipHash: meta.ipHash ?? null,
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
    createdAt: now,
  });

  return { token, expiresAt };
}

export async function getSessionUserByToken(
  db: DbExecutor,
  token: string,
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      accountStatus: users.accountStatus,
      sessionId: sessions.id,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row || row.accountStatus !== "active") {
    return null;
  }

  const lastActivityAt = row.lastUsedAt ?? row.createdAt;
  if (
    now.getTime() - lastActivityAt.getTime() >=
    getSessionIdleTtlSeconds() * 1000
  ) {
    return null;
  }

  const throttleBefore = new Date(
    now.getTime() - SESSION_LAST_USED_THROTTLE_SECONDS * 1000,
  );
  try {
    await db
      .update(sessions)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(sessions.id, row.sessionId),
          isNull(sessions.revokedAt),
          or(
            isNull(sessions.lastUsedAt),
            lte(sessions.lastUsedAt, throttleBefore),
          ),
        ),
      );
  } catch (error) {
    // Activity bookkeeping must not turn a valid session into a failed request.
    logger.warn("session.last_used_update_failed", {
      context: { sessionId: row.sessionId },
      error,
      includeErrorDetails: false,
    });
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    accountStatus: row.accountStatus,
    sessionId: row.sessionId,
  };
}

export async function revokeSessionByToken(
  db: DbExecutor,
  token: string,
  now = new Date(),
): Promise<void> {
  if (!token) return;
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)),
    );
}

export async function revokeAllUserSessions(
  db: DbExecutor,
  userId: string,
  now = new Date(),
): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return revoked.length;
}

export async function revokeSessionById(
  db: DbExecutor,
  userId: string,
  sessionId: string,
  now = new Date(),
): Promise<boolean> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });

  return revoked.length > 0;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getCurrentUser(
  db: DbExecutor,
  now?: Date,
): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  return getSessionUserByToken(db, token, now ?? new Date());
}
