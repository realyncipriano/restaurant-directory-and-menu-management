import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import {
  auditLogs,
  mfaChallenges,
  mfaRecoveryCodes,
  sessions,
  users,
} from "@/db/schema";
import { createSession, getSessionUserByToken } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { generateTotpCode, totpStepForDate } from "@/lib/auth/totp";
import {
  InvalidCredentialsError,
  InvalidMfaCodeError,
  MfaChallengeInvalidError,
  MfaChallengeRequiredError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import {
  beginMfaEnrollment,
  cancelMfaEnrollment,
  completeMfaChallenge,
  confirmMfaEnrollment,
  createPasswordResetLink,
  disableMfa,
  getMfaEnrollmentSetup,
  getMfaStatus,
  loginWithPassword,
  regenerateRecoveryCodes,
  resetPasswordWithToken,
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
const LAST = new Date(NOW.getTime() + 120_000);
const NEW_PASSWORD = "New-Password-456!";

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

async function challengeFrom(
  promise: Promise<unknown>,
): Promise<MfaChallengeRequiredError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MfaChallengeRequiredError);
    return error as MfaChallengeRequiredError;
  }
  throw new Error("Expected an MFA challenge.");
}

describe("multi-factor authentication (ephemeral PGlite)", () => {
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

  it("enrolls an authenticator, encrypts the secret, and stores only hashed recovery codes", async () => {
    const user = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const setup = await beginMfaEnrollment(db, {
      actorId: user.id,
      now: NOW,
    });
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain("otpauth://totp/");
    expect(setup.otpauthUrl).toContain(encodeURIComponent(setup.secret));

    expect(await getMfaStatus(db, user.id)).toMatchObject({
      enabled: false,
      pending: true,
      recoveryCodesRemaining: 0,
      required: false,
    });
    expect(await getMfaEnrollmentSetup(db, user.id)).toEqual(setup);

    await expect(
      confirmMfaEnrollment(db, {
        actorId: user.id,
        code: "000000",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const confirmed = await confirmMfaEnrollment(db, {
      actorId: user.id,
      code: generateTotpCode(setup.secret, totpStepForDate(NOW)),
      now: NOW,
    });
    expect(confirmed.recoveryCodes).toHaveLength(10);

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.mfaEnabledAt).toEqual(NOW);
    expect(row?.mfaTotpSecret).not.toBe(setup.secret);
    expect(row?.mfaLastUsedStep).toBe(totpStepForDate(NOW));

    const codes = await db
      .select()
      .from(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, user.id));
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map((code) => code.codeHash)).size).toBe(10);
    for (const code of confirmed.recoveryCodes) {
      expect(codes.some((row) => row.codeHash === code)).toBe(false);
    }

    expect(await getMfaStatus(db, user.id)).toMatchObject({
      enabled: true,
      pending: false,
      recoveryCodesRemaining: 10,
    });
    expect(await getMfaEnrollmentSetup(db, user.id)).toBeNull();

    const auditRows = await db.select().from(auditLogs);
    const auditText = JSON.stringify(
      auditRows.map((entry) => ({
        action: entry.action,
        details: entry.details,
      })),
    );
    expect(auditText).toContain("mfa_enabled");
    expect(auditText).not.toContain(setup.secret);
    expect(auditText).not.toContain(confirmed.recoveryCodes[0]!);
  });

  it("cancels a pending setup without enabling MFA", async () => {
    const user = await seedUser(db, { email: "cancel@example.com" });
    await beginMfaEnrollment(db, { actorId: user.id, now: NOW });
    await cancelMfaEnrollment(db, { actorId: user.id, now: LATER });

    expect(await getMfaStatus(db, user.id)).toMatchObject({
      enabled: false,
      pending: false,
    });
    expect(await getMfaEnrollmentSetup(db, user.id)).toBeNull();

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.mfaTotpSecret).toBeNull();
  });

  it("requires a challenge at login, rejects wrong codes, and consumes the challenge once", async () => {
    const user = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const { secret } = await enableMfa(db, user.id);

    const failure = await challengeFrom(
      loginWithPassword(db, {
        email: "admin@example.com",
        password: TEST_PASSWORD,
        ipHash: "ip-mfa-login",
        now: LATER,
      }),
    );
    const challenge = failure.challenge;
    expect(challenge.token.length).toBeGreaterThan(20);
    expect(challenge.expiresAt).toEqual(
      new Date(LATER.getTime() + 5 * 60 * 1000),
    );

    expect(await db.select().from(sessions)).toHaveLength(0);
    const [challengeRow] = await db.select().from(mfaChallenges);
    expect(challengeRow?.tokenHash).toBe(hashToken(challenge.token));
    expect(challengeRow?.tokenHash).not.toBe(challenge.token);

    await expect(
      completeMfaChallenge(db, {
        challengeToken: challenge.token,
        code: "000000",
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    expect(await db.select().from(sessions)).toHaveLength(0);

    const result = await completeMfaChallenge(db, {
      challengeToken: challenge.token,
      code: generateTotpCode(secret, totpStepForDate(LATER)),
      now: LATER,
    });
    expect(
      await getSessionUserByToken(db, result.session.token, LATER),
    ).not.toBeNull();

    await expect(
      completeMfaChallenge(db, {
        challengeToken: challenge.token,
        code: generateTotpCode(secret, totpStepForDate(LATER)),
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(MfaChallengeInvalidError);

    const again = await challengeFrom(
      loginWithPassword(db, {
        email: "admin@example.com",
        password: TEST_PASSWORD,
        ipHash: "ip-mfa-login",
        now: LATER,
      }),
    );
    await expect(
      completeMfaChallenge(db, {
        challengeToken: again.challenge.token,
        code: generateTotpCode(secret, totpStepForDate(LATER)),
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const nextStep = totpStepForDate(LATER) + 1;
    const accepted = await completeMfaChallenge(db, {
      challengeToken: again.challenge.token,
      code: generateTotpCode(secret, nextStep),
      now: new Date(LATER.getTime() + 30_000),
    });
    expect(
      await getSessionUserByToken(db, accepted.session.token, LATER),
    ).not.toBeNull();

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(userRow?.mfaLastUsedStep).toBe(nextStep);

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "mfa_challenge_succeeded"));
    expect(auditRows).toHaveLength(2);
    expect(JSON.stringify(auditRows.map((row) => row.details))).not.toContain(
      challenge.token,
    );
  });

  it("accepts each recovery code once, case-insensitively, and decrements the count", async () => {
    const user = await seedUser(db, { email: "recovery@example.com" });
    const { recoveryCodes } = await enableMfa(db, user.id);

    const first = await challengeFrom(
      loginWithPassword(db, {
        email: "recovery@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    const firstLogin = await completeMfaChallenge(db, {
      challengeToken: first.challenge.token,
      code: recoveryCodes[0]!.toLowerCase(),
      now: LATER,
    });
    expect(
      await getSessionUserByToken(db, firstLogin.session.token, LATER),
    ).not.toBeNull();

    const replay = await challengeFrom(
      loginWithPassword(db, {
        email: "recovery@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    await expect(
      completeMfaChallenge(db, {
        challengeToken: replay.challenge.token,
        code: recoveryCodes[0]!,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const second = await challengeFrom(
      loginWithPassword(db, {
        email: "recovery@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    await completeMfaChallenge(db, {
      challengeToken: second.challenge.token,
      code: recoveryCodes[1]!,
      now: LATER,
    });

    expect(await getMfaStatus(db, user.id)).toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 8,
    });

    const used = await db
      .select()
      .from(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, user.id));
    expect(used.filter((row) => row.usedAt !== null)).toHaveLength(2);
  });

  it("rejects expired challenges and rate-limits repeated code attempts", async () => {
    const user = await seedUser(db, { email: "limit@example.com" });
    await enableMfa(db, user.id);

    const expired = await challengeFrom(
      loginWithPassword(db, {
        email: "limit@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    await expect(
      completeMfaChallenge(db, {
        challengeToken: expired.challenge.token,
        code: "000000",
        now: new Date(LATER.getTime() + 6 * 60 * 1000),
      }),
    ).rejects.toBeInstanceOf(MfaChallengeInvalidError);

    const limited = await challengeFrom(
      loginWithPassword(db, {
        email: "limit@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        completeMfaChallenge(db, {
          challengeToken: limited.challenge.token,
          code: "000000",
          now: LATER,
        }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    }
    await expect(
      completeMfaChallenge(db, {
        challengeToken: limited.challenge.token,
        code: "000000",
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const rateLimitAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "mfa_rate_limited"));
    expect(rateLimitAudits).toHaveLength(1);
  });

  it("requires MFA after a password reset and does not create a session directly", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const { secret } = await enableMfa(db, member.id, NOW);

    const oldSession = await createSession(
      db,
      member.id,
      { userAgent: "old device" },
      NOW,
    );
    const reset = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    const failure = await challengeFrom(
      resetPasswordWithToken(db, {
        token: reset.token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: LATER,
      }),
    );

    expect(
      await getSessionUserByToken(db, oldSession.token, LATER),
    ).toBeNull();
    const activeSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, member.id));
    expect(activeSessions.filter((row) => row.revokedAt === null)).toHaveLength(
      0,
    );

    const result = await completeMfaChallenge(db, {
      challengeToken: failure.challenge.token,
      code: generateTotpCode(secret, totpStepForDate(LATER)),
      now: LATER,
    });
    expect(
      await getSessionUserByToken(db, result.session.token, LATER),
    ).not.toBeNull();

    await expect(
      loginWithPassword(db, {
        email: "member@example.com",
        password: TEST_PASSWORD,
        now: LAST,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const newLogin = await challengeFrom(
      loginWithPassword(db, {
        email: "member@example.com",
        password: NEW_PASSWORD,
        now: LAST,
      }),
    );
    expect(newLogin.challenge.token).toBeTruthy();
  });

  it("disables MFA with the password and a valid code, keeping only the current session", async () => {
    const user = await seedUser(db, { email: "disable@example.com" });
    const { secret } = await enableMfa(db, user.id, NOW);

    const first = await createSession(db, user.id, {}, NOW);
    const second = await createSession(
      db,
      user.id,
      {},
      new Date(NOW.getTime() + 1000),
    );
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    const firstId = sessionRows.find(
      (row) => row.tokenHash === hashToken(first.token),
    )!.id;
    expect(sessionRows).toHaveLength(2);

    await expect(
      disableMfa(db, {
        actorId: user.id,
        password: "Wrong-Password-999!",
        code: generateTotpCode(secret, totpStepForDate(LATER)),
        currentSessionId: firstId,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      disableMfa(db, {
        actorId: user.id,
        password: TEST_PASSWORD,
        code: "000000",
        currentSessionId: firstId,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    await disableMfa(db, {
      actorId: user.id,
      password: TEST_PASSWORD,
      code: generateTotpCode(secret, totpStepForDate(LATER)),
      currentSessionId: firstId,
      now: LATER,
    });

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.mfaEnabledAt).toBeNull();
    expect(row?.mfaTotpSecret).toBeNull();
    expect(row?.mfaLastUsedStep).toBeNull();
    expect(await getMfaStatus(db, user.id)).toMatchObject({
      enabled: false,
      pending: false,
      recoveryCodesRemaining: 0,
    });

    const remainingSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(
      remainingSessions.filter((session) => session.revokedAt === null),
    ).toHaveLength(1);
    expect(
      remainingSessions.find((session) => session.id === firstId)?.revokedAt,
    ).toBeNull();
    expect(
      remainingSessions.find((session) => session.tokenHash === hashToken(second.token))
        ?.revokedAt,
    ).not.toBeNull();

    const login = await loginWithPassword(db, {
      email: "disable@example.com",
      password: TEST_PASSWORD,
      now: LAST,
    });
    expect(login.session.token).toHaveLength(43);
  });

  it("regenerates recovery codes and invalidates the previous set", async () => {
    const user = await seedUser(db, { email: "regenerate@example.com" });
    const { secret, recoveryCodes: oldCodes } = await enableMfa(
      db,
      user.id,
      NOW,
    );

    const regenerated = await regenerateRecoveryCodes(db, {
      actorId: user.id,
      code: generateTotpCode(secret, totpStepForDate(LATER)),
      now: LATER,
    });
    expect(regenerated.recoveryCodes).toHaveLength(10);
    expect(
      regenerated.recoveryCodes.some((code) => oldCodes.includes(code)),
    ).toBe(false);

    const first = await challengeFrom(
      loginWithPassword(db, {
        email: "regenerate@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    await expect(
      completeMfaChallenge(db, {
        challengeToken: first.challenge.token,
        code: oldCodes[0]!,
        now: LATER,
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    const second = await challengeFrom(
      loginWithPassword(db, {
        email: "regenerate@example.com",
        password: TEST_PASSWORD,
        now: LATER,
      }),
    );
    await completeMfaChallenge(db, {
      challengeToken: second.challenge.token,
      code: regenerated.recoveryCodes[0]!,
      now: LATER,
    });
    expect(await getMfaStatus(db, user.id)).toMatchObject({
      recoveryCodesRemaining: 9,
    });
  });

  it("reports administrator enforcement without enabling it by default", async () => {
    const admin = await seedUser(db, {
      email: "required@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "optional@example.com" });

    expect((await getMfaStatus(db, admin.id)).required).toBe(false);

    process.env.MFA_REQUIRED_FOR_ADMINS = "1";
    try {
      expect((await getMfaStatus(db, admin.id)).required).toBe(true);
      expect((await getMfaStatus(db, member.id)).required).toBe(false);

      await enableMfa(db, admin.id, NOW);
      expect(await getMfaStatus(db, admin.id)).toMatchObject({
        required: true,
        enabled: true,
      });
    } finally {
      delete process.env.MFA_REQUIRED_FOR_ADMINS;
    }
  });
});
