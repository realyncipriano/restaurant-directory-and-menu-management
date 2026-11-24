import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { sessions } from "@/db/schema";
import { getSessionIdleTtlSeconds } from "@/lib/auth/constants";
import {
  getSessionUserByToken,
  revokeAllUserSessions,
  revokeSessionById,
  revokeSessionByToken,
} from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { normalizeUuid } from "@/lib/validation/ids";
import { writeAuditLog } from "../audit";
import { requireActiveActor } from "./actors";

export type UserSessionSummary = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  userAgent: string | null;
  isCurrent: boolean;
};

export async function listUserSessions(
  db: DbClient,
  input: {
    actorId: string;
    currentSessionId: string;
    now?: Date;
  },
): Promise<UserSessionSummary[]> {
  const now = input.now ?? new Date();
  await requireActiveActor(db, input.actorId);

  const idleCutoff = new Date(
    now.getTime() - getSessionIdleTtlSeconds() * 1000,
  );
  const activity = sql<Date>`coalesce(${sessions.lastUsedAt}, ${sessions.createdAt})`;

  const rows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, input.actorId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(activity, idleCutoff),
      ),
    )
    .orderBy(desc(activity))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    isCurrent: row.id === input.currentSessionId,
  }));
}

export async function revokeUserSession(
  db: DbClient,
  input: {
    actorId: string;
    sessionId: string;
    currentSessionId?: string | null;
    now?: Date;
  },
): Promise<{ currentSession: boolean }> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  const sessionId = normalizeUuid(input.sessionId);
  if (!sessionId) {
    throw new NotFoundError("That session is no longer active.");
  }

  const revoked = await revokeSessionById(db, actor.id, sessionId, now);
  if (!revoked) {
    throw new NotFoundError("That session is no longer active.");
  }

  const currentSession = sessionId === input.currentSessionId;
  await writeAuditLog(db, {
    actor,
    action: "session_revoked",
    entityType: "session",
    entityId: sessionId,
    details: { current: currentSession },
  });

  return { currentSession };
}

export async function signOutAllSessions(
  db: DbClient,
  actorId: string,
  now = new Date(),
): Promise<number> {
  const actor = await requireActiveActor(db, actorId);
  const revokedCount = await revokeAllUserSessions(db, actor.id, now);

  await writeAuditLog(db, {
    actor,
    action: "sessions_revoked_all",
    entityType: "user",
    entityId: actor.id,
    details: { revokedCount },
  });

  return revokedCount;
}

export async function signOutCurrentSession(
  db: DbClient,
  token: string | null,
  now = new Date(),
): Promise<{ sessionId: string } | null> {
  if (!token) return null;

  const session = await getSessionUserByToken(db, token, now);
  await revokeSessionByToken(db, token, now);
  if (!session) return null;

  await writeAuditLog(db, {
    actor: { id: session.id, email: session.email },
    action: "user_logout",
    entityType: "session",
    entityId: session.sessionId,
  });

  return { sessionId: session.sessionId };
}
