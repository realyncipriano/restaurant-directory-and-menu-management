import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { auditLogs, sessions } from "@/db/schema";
import {
  SESSION_LAST_USED_THROTTLE_SECONDS,
  SESSION_TTL_SECONDS,
  getSessionIdleTtlSeconds,
} from "@/lib/auth/constants";
import { getSessionUserByToken, revokeSessionByToken } from "@/lib/auth/session";
import { hashIdentifier, hashToken } from "@/lib/auth/tokens";
import { InvalidCredentialsError, NotFoundError, RateLimitedError } from "@/lib/errors";
import {
  loginWithPassword,
  listUserSessions,
  revokeUserSession,
  signOutAllSessions,
  signOutCurrentSession,
} from "@/server/services/auth";
import {
  openTestDb,
  resetTestDb,
  seedUser,
  TEST_PASSWORD,
} from "../helpers/db";
import type { EphemeralDb } from "./ephemeral-db";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

describe("session management (ephemeral PGlite)", () => {
  let handle: EphemeralDb;
  let db: DbClient;

  beforeAll(async () => {
    const opened = await openTestDb();
    handle = opened.handle;
    db = opened.db;
  });

  afterAll(async () => {
    await handle.client.close();
  });

  beforeEach(async () => {
    await resetTestDb(handle);
  });

  async function loginSession(
    email: string,
    now: Date,
    userAgent: string | null = null,
  ) {
    const result = await loginWithPassword(db, {
      email,
      password: TEST_PASSWORD,
      userAgent,
      now,
    });
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(result.session.token)))
      .limit(1);
    return { ...result, token: result.session.token, session: row! };
  }

  async function readSession(sessionId: string) {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return row!;
  }

  it("lists active sessions with metadata and identifies the current one", async () => {
    const user = await seedUser(db, { email: "sessions@example.com" });
    const first = await loginSession(
      user.email,
      NOW,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36",
    );
    const second = await loginSession(
      user.email,
      new Date(NOW.getTime() + HOUR_MS),
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
    );

    const third = await loginSession(
      user.email,
      new Date(NOW.getTime() + 2 * HOUR_MS),
    );
    await revokeSessionByToken(
      db,
      third.token,
      new Date(NOW.getTime() + 2 * HOUR_MS),
    );

    await db.insert(sessions).values({
      tokenHash: "expired-session-hash",
      userId: user.id,
      expiresAt: new Date(NOW.getTime() - 60_000),
      createdAt: new Date(NOW.getTime() - SESSION_TTL_SECONDS * 1000 - 60_000),
    });
    await db.insert(sessions).values({
      tokenHash: "idle-session-hash",
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
      createdAt: new Date(NOW.getTime() - 25 * HOUR_MS),
    });

    const listed = await listUserSessions(db, {
      actorId: user.id,
      currentSessionId: second.session.id,
      now: new Date(NOW.getTime() + 3 * HOUR_MS),
    });

    expect(listed).toHaveLength(2);
    expect(listed.map((session) => session.id)).toEqual([
      second.session.id,
      first.session.id,
    ]);
    expect(listed[0]?.isCurrent).toBe(true);
    expect(listed[1]?.isCurrent).toBe(false);
    expect(listed[0]?.userAgent).toContain("Macintosh");
    expect(listed[0]?.lastUsedAt).toBeNull();
  });

  it("revokes only the owner's session and records sanitized audit events", async () => {
    const alice = await seedUser(db, { email: "alice@example.com" });
    const bob = await seedUser(db, { email: "bob@example.com" });
    const aliceCurrent = await loginSession(alice.email, NOW);
    const aliceOther = await loginSession(
      alice.email,
      new Date(NOW.getTime() + 1000),
    );
    const bobSession = await loginSession(bob.email, NOW);

    await expect(
      revokeUserSession(db, {
        actorId: alice.id,
        sessionId: bobSession.session.id,
        currentSessionId: aliceCurrent.session.id,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(
      await getSessionUserByToken(db, bobSession.token, NOW),
    ).not.toBeNull();

    const other = await revokeUserSession(db, {
      actorId: alice.id,
      sessionId: aliceOther.session.id,
      currentSessionId: aliceCurrent.session.id,
      now: new Date(NOW.getTime() + 2000),
    });
    expect(other.currentSession).toBe(false);
    expect(
      await getSessionUserByToken(
        db,
        aliceOther.token,
        new Date(NOW.getTime() + 2000),
      ),
    ).toBeNull();
    expect(
      await getSessionUserByToken(
        db,
        aliceCurrent.token,
        new Date(NOW.getTime() + 2000),
      ),
    ).not.toBeNull();

    const current = await revokeUserSession(db, {
      actorId: alice.id,
      sessionId: aliceCurrent.session.id,
      currentSessionId: aliceCurrent.session.id,
      now: new Date(NOW.getTime() + 3000),
    });
    expect(current.currentSession).toBe(true);
    expect(
      await getSessionUserByToken(
        db,
        aliceCurrent.token,
        new Date(NOW.getTime() + 3000),
      ),
    ).toBeNull();

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "session_revoked"))
      .orderBy(desc(auditLogs.createdAt));
    expect(audits).toHaveLength(2);
    expect(audits.map((row) => row.entityId)).toEqual(
      expect.arrayContaining([aliceOther.session.id, aliceCurrent.session.id]),
    );
    expect(audits[0]?.details).toEqual({ current: true });
    expect(audits[1]?.details).toEqual({ current: false });
    expect(audits.every((row) => row.actorId === alice.id)).toBe(true);
  });

  it("throttles lastUsedAt writes and enforces idle and absolute expiry", async () => {
    const user = await seedUser(db, { email: "activity@example.com" });
    const login = await loginSession(user.email, NOW);
    expect((await readSession(login.session.id)).lastUsedAt).toBeNull();

    const firstUse = new Date(NOW.getTime() + 1000);
    expect(
      await getSessionUserByToken(db, login.token, firstUse),
    ).not.toBeNull();
    expect(
      (await readSession(login.session.id)).lastUsedAt?.getTime(),
    ).toBe(firstUse.getTime());

    const withinThrottle = new Date(firstUse.getTime() + 60_000);
    expect(
      await getSessionUserByToken(db, login.token, withinThrottle),
    ).not.toBeNull();
    expect(
      (await readSession(login.session.id)).lastUsedAt?.getTime(),
    ).toBe(firstUse.getTime());

    const afterThrottle = new Date(
      firstUse.getTime() + (SESSION_LAST_USED_THROTTLE_SECONDS + 1) * 1000,
    );
    expect(
      await getSessionUserByToken(db, login.token, afterThrottle),
    ).not.toBeNull();
    expect(
      (await readSession(login.session.id)).lastUsedAt?.getTime(),
    ).toBe(afterThrottle.getTime());

    const idleBoundary = new Date(
      afterThrottle.getTime() + getSessionIdleTtlSeconds() * 1000,
    );
    expect(
      await getSessionUserByToken(db, login.token, idleBoundary),
    ).toBeNull();
    expect(
      (await readSession(login.session.id)).lastUsedAt?.getTime(),
    ).toBe(afterThrottle.getTime());

    const absoluteLogin = await loginSession(
      user.email,
      new Date(NOW.getTime() + 2 * HOUR_MS),
    );
    const absoluteExpiry = new Date(
      absoluteLogin.session.createdAt.getTime() +
        SESSION_TTL_SECONDS * 1000 +
        1000,
    );
    expect(
      await getSessionUserByToken(db, absoluteLogin.token, absoluteExpiry),
    ).toBeNull();
  });

  it("signs out every session and records the revoked count", async () => {
    const user = await seedUser(db, { email: "all@example.com" });
    const first = await loginSession(user.email, NOW);
    const second = await loginSession(user.email, new Date(NOW.getTime() + HOUR_MS));

    const count = await signOutAllSessions(
      db,
      user.id,
      new Date(NOW.getTime() + 2 * HOUR_MS),
    );
    expect(count).toBe(2);
    expect(
      await getSessionUserByToken(
        db,
        first.token,
        new Date(NOW.getTime() + 2 * HOUR_MS),
      ),
    ).toBeNull();
    expect(
      await getSessionUserByToken(
        db,
        second.token,
        new Date(NOW.getTime() + 2 * HOUR_MS),
      ),
    ).toBeNull();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "sessions_revoked_all"));
    expect(audit?.actorId).toBe(user.id);
    expect(audit?.entityId).toBe(user.id);
    expect(audit?.details).toEqual({ revokedCount: 2 });
  });

  it("records a logout event only while the session is valid", async () => {
    const user = await seedUser(db, { email: "logout@example.com" });
    const login = await loginSession(user.email, NOW);

    const result = await signOutCurrentSession(db, login.token, NOW);
    expect(result?.sessionId).toBe(login.session.id);
    expect(
      await getSessionUserByToken(db, login.token, NOW),
    ).toBeNull();

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_logout"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.entityId).toBe(login.session.id);

    expect(await signOutCurrentSession(db, login.token, NOW)).toBeNull();
    const afterSecondCall = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_logout"));
    expect(afterSecondCall).toHaveLength(1);
  });

  it("records sanitized failed-login audit events", async () => {
    const unknownEmail = "nobody@example.com";
    const rawPassword = "Wrong-Password-999!";
    await expect(
      loginWithPassword(db, {
        email: unknownEmail,
        password: rawPassword,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const user = await seedUser(db, { email: "failed@example.com" });
    await expect(
      loginWithPassword(db, {
        email: user.email,
        password: rawPassword,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const inactive = await seedUser(db, {
      email: "inactive@example.com",
      status: "deactivated",
    });
    await expect(
      loginWithPassword(db, {
        email: inactive.email,
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "login_failed"));
    expect(rows).toHaveLength(3);

    const unknown = rows.find((row) => row.actorId === null);
    expect(unknown?.details).toEqual({
      reason: "unknown_account",
      emailHash: hashIdentifier(unknownEmail),
    });
    expect(unknown?.actorEmail).toBeNull();

    const wrongPassword = rows.find((row) => row.actorId === user.id);
    expect(wrongPassword?.details).toEqual({ reason: "invalid_password" });
    expect(wrongPassword?.actorEmail).toBe(user.email);

    const inactiveRow = rows.find((row) => row.actorId === inactive.id);
    expect(inactiveRow?.details).toEqual({ reason: "account_not_active" });

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(rawPassword);
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain(unknownEmail);
  });

  it("records a single rate-limit activation per window", async () => {
    const user = await seedUser(db, { email: "throttled@example.com" });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        loginWithPassword(db, {
          email: user.email,
          password: "Wrong-Password-999!",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    await expect(
      loginWithPassword(db, {
        email: user.email,
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      loginWithPassword(db, {
        email: user.email,
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "login_rate_limited"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toEqual({
      scope: "account",
      emailHash: hashIdentifier(user.email),
    });
  });
});
