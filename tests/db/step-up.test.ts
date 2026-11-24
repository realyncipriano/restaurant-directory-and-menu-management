import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { auditLogs, sessions, users } from "@/db/schema";
import { createSession, getSessionUserByToken } from "@/lib/auth/session";
import { isStepUpFresh } from "@/lib/auth/step-up";
import { hashToken } from "@/lib/auth/tokens";
import { generateTotpCode, totpStepForDate } from "@/lib/auth/totp";
import {
  InvalidMfaCodeError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  getMfaStatus,
  verifyStepUp,
} from "@/server/services/auth";
import {
  openTestDb,
  resetTestDb,
  seedUser,
  TEST_PASSWORD,
} from "../helpers/db";
import type { EphemeralDb } from "./ephemeral-db";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date(NOW.getTime() + 60_000);

async function enableMfa(
  db: DbClient,
  userId: string,
  now = NOW,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await beginMfaEnrollment(db, { actorId: userId, now });
  const result = await confirmMfaEnrollment(db, {
    actorId: userId,
    code: generateTotpCode(setup.secret, totpStepForDate(now)),
    now,
  });
  return { secret: setup.secret, recoveryCodes: result.recoveryCodes };
}

async function sessionIdForToken(
  db: DbClient,
  token: string,
): Promise<string> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row) throw new Error("Expected a session row.");
  return row.id;
}

describe("step-up authentication (ephemeral PGlite)", () => {
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

  it("verifies the password and marks only the current session fresh", async () => {
    const user = await seedUser(db, { email: "step-up@example.com" });
    const current = await createSession(db, user.id, {}, NOW);
    const other = await createSession(db, user.id, {}, NOW);

    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId: await sessionIdForToken(db, current.token),
        password: "Wrong-Password-999!",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      await getSessionUserByToken(db, current.token, NOW),
    ).toMatchObject({ steppedUpAt: null });

    const result = await verifyStepUp(db, {
      actorId: user.id,
      sessionId: await sessionIdForToken(db, current.token),
      password: TEST_PASSWORD,
      now: NOW,
    });
    expect(result).toEqual({ method: "password" });

    const currentUser = await getSessionUserByToken(db, current.token, NOW);
    expect(currentUser?.steppedUpAt).toEqual(NOW);
    expect(isStepUpFresh(currentUser?.steppedUpAt, NOW)).toBe(true);
    expect(
      await getSessionUserByToken(db, other.token, NOW),
    ).toMatchObject({ steppedUpAt: null });

    const audits = await db.select().from(auditLogs);
    const audited = JSON.stringify(
      audits.map((row) => ({ action: row.action, details: row.details })),
    );
    expect(audited).toContain("step_up_succeeded");
    expect(audited).toContain("step_up_failed");
    expect(audited).not.toContain(TEST_PASSWORD);
    expect(audited).not.toContain("Wrong-Password-999!");
    expect(audited).not.toContain(current.token);
  });

  it("requires an MFA code, rejects replay, and consumes a recovery code once", async () => {
    const user = await seedUser(db, { email: "mfa-step-up@example.com" });
    const { secret, recoveryCodes } = await enableMfa(db, user.id, NOW);
    const session = await createSession(db, user.id, {}, LATER);
    const sessionId = await sessionIdForToken(db, session.token);

    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId,
        password: TEST_PASSWORD,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    expect(
      await getSessionUserByToken(db, session.token, LATER),
    ).toMatchObject({ steppedUpAt: null });

    const code = generateTotpCode(secret, totpStepForDate(LATER));
    expect(
      await verifyStepUp(db, {
        actorId: user.id,
        sessionId,
        password: TEST_PASSWORD,
        code,
        now: LATER,
      }),
    ).toEqual({ method: "totp" });

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(userRow?.mfaLastUsedStep).toBe(totpStepForDate(LATER));

    const replaySession = await createSession(db, user.id, {}, LATER);
    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId: await sessionIdForToken(db, replaySession.token),
        password: TEST_PASSWORD,
        code,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const recoverySession = await createSession(db, user.id, {}, LATER);
    expect(
      await verifyStepUp(db, {
        actorId: user.id,
        sessionId: await sessionIdForToken(db, recoverySession.token),
        password: TEST_PASSWORD,
        code: recoveryCodes[0]!.toLowerCase(),
        now: LATER,
      }),
    ).toEqual({ method: "recovery" });
    expect(await getMfaStatus(db, user.id)).toMatchObject({
      recoveryCodesRemaining: 9,
    });

    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId: await sessionIdForToken(db, recoverySession.token),
        password: TEST_PASSWORD,
        code: recoveryCodes[0]!,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const audits = await db.select().from(auditLogs);
    const audited = JSON.stringify(
      audits.map((row) => ({ action: row.action, details: row.details })),
    );
    expect(audited).not.toContain(code);
    expect(audited).not.toContain(recoveryCodes[0]!);
  });

  it("rejects revoked and expired sessions", async () => {
    const user = await seedUser(db, { email: "stale-session@example.com" });
    const revoked = await createSession(db, user.id, {}, NOW);
    await db
      .update(sessions)
      .set({ revokedAt: NOW })
      .where(eq(sessions.id, await sessionIdForToken(db, revoked.token)));

    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId: await sessionIdForToken(db, revoked.token),
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);

    const expired = await createSession(db, user.id, {}, NOW);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(NOW.getTime() - 1) })
      .where(eq(sessions.id, await sessionIdForToken(db, expired.token)));

    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId: await sessionIdForToken(db, expired.token),
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rate-limits repeated failures and audits the limit once", async () => {
    const user = await seedUser(db, { email: "rate-limit@example.com" });
    const session = await createSession(db, user.id, {}, NOW);
    const sessionId = await sessionIdForToken(db, session.token);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifyStepUp(db, {
          actorId: user.id,
          sessionId,
          password: "Wrong-Password-999!",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }

    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId,
        password: "Wrong-Password-999!",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      verifyStepUp(db, {
        actorId: user.id,
        sessionId,
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const rateLimitAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "step_up_rate_limited"));
    expect(rateLimitAudits).toHaveLength(1);
  });
});
