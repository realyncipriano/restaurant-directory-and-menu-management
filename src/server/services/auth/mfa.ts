import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { mfaChallenges, mfaRecoveryCodes, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { MFA_CHALLENGE_TTL_SECONDS } from "@/lib/auth/constants";
import {
  buildTotpProvisioningUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { consumeRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import {
  createSession,
  revokeOtherUserSessions,
} from "@/lib/auth/session";
import { generateSecureToken, hashToken } from "@/lib/auth/tokens";
import { TOTP_DIGITS, verifyTotpCode } from "@/lib/auth/totp";
import { isMfaRequiredForAdmins } from "@/lib/env";
import {
  ConflictError,
  InvalidMfaCodeError,
  MfaChallengeInvalidError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import { logger } from "@/lib/observability/logger";
import { writeAuditLog } from "../audit";
import { requireActiveActor } from "./actors";
import {
  publicUser,
  type AuthResult,
  type UserRow,
} from "./shared";

const MFA_CHALLENGE_LIMIT = 5;
const MFA_CHALLENGE_WINDOW_SECONDS = 10 * 60;
const MFA_ACCOUNT_LIMIT = 10;
const MFA_ACCOUNT_WINDOW_SECONDS = 60 * 60;
const MFA_ENROLL_LIMIT = 10;
const MFA_ENROLL_WINDOW_SECONDS = 15 * 60;
const MFA_MANAGE_LIMIT = 10;
const MFA_MANAGE_WINDOW_SECONDS = 15 * 60;
const RECOVERY_CODE_LENGTH = 12;

export type MfaChallengeIssue = {
  token: string;
  expiresAt: Date;
};

export type MfaStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  pending: boolean;
  recoveryCodesRemaining: number;
  required: boolean;
};

export type MfaEnrollmentSetup = {
  secret: string;
  otpauthUrl: string;
};

export type MfaRecoveryCodeSet = {
  recoveryCodes: string[];
};

type MfaActor = Pick<UserRow, "id" | "email">;

function mfaActor(user: MfaActor): MfaActor {
  return { id: user.id, email: user.email };
}

function normalizedTotpInput(code: string): string | null {
  const normalized = code.replace(/\s+/g, "");
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`, "u").test(normalized)
    ? normalized
    : null;
}

function methodForCode(code: string): "totp" | "recovery" {
  return normalizedTotpInput(code) ? "totp" : "recovery";
}

async function enforceMfaRateLimit(
  db: DbExecutor,
  entry: {
    key: string;
    limit: number;
    windowSeconds: number;
    now: Date;
    scope: string;
    actor: MfaActor;
  },
): Promise<void> {
  const result = await consumeRateLimit(db, entry);
  if (result.allowed) return;

  if (result.count === entry.limit + 1) {
    await writeAuditLog(db, {
      actor: entry.actor,
      action: "mfa_rate_limited",
      entityType: "auth",
      entityId: entry.actor.id,
      details: { scope: entry.scope },
    });
  }

  throw new RateLimitedError(result.retryAfterSeconds);
}

async function auditMfaFailure(
  db: DbExecutor,
  actor: MfaActor,
  action: string,
  code: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await writeAuditLog(db, {
    actor,
    action,
    entityType: "auth",
    entityId: actor.id,
    details: { method: methodForCode(code), ...details },
  });
}

function readTotpSecret(user: UserRow): string {
  if (!user.mfaTotpSecret) {
    throw new InvalidMfaCodeError(
      "Authenticator verification is unavailable. Use a recovery code.",
    );
  }

  try {
    return decryptTotpSecret(user.mfaTotpSecret);
  } catch (error) {
    logger.error("mfa.secret_decrypt_failed", {
      context: { userId: user.id },
      error,
      includeErrorDetails: false,
    });
    throw new InvalidMfaCodeError(
      "Authenticator verification is unavailable. Use a recovery code.",
    );
  }
}

async function remainingRecoveryCodes(
  db: DbExecutor,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mfaRecoveryCodes)
    .where(
      and(
        eq(mfaRecoveryCodes.userId, userId),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    );

  return row?.count ?? 0;
}

async function consumeSecondFactor(
  tx: DbExecutor,
  user: UserRow,
  code: string,
  now: Date,
): Promise<{ method: "totp" | "recovery"; step: number | null }> {
  const totpCode = normalizedTotpInput(code);

  if (totpCode) {
    const secret = readTotpSecret(user);
    const verification = verifyTotpCode(secret, totpCode, {
      now,
      lastUsedStep: user.mfaLastUsedStep,
    });

    if (!verification.valid) {
      throw new InvalidMfaCodeError(
        verification.reason === "replay"
          ? "That code was already used. Wait for your authenticator to show a new code."
          : undefined,
      );
    }

    const updated = await tx
      .update(users)
      .set({ mfaLastUsedStep: verification.step, updatedAt: now })
      .where(
        and(
          eq(users.id, user.id),
          or(
            isNull(users.mfaLastUsedStep),
            lt(users.mfaLastUsedStep, verification.step),
          ),
        ),
      )
      .returning({ id: users.id });

    if (updated.length === 0) {
      throw new InvalidMfaCodeError(
        "That code was already used. Wait for your authenticator to show a new code.",
      );
    }

    return { method: "totp", step: verification.step };
  }

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_LENGTH) {
    throw new InvalidMfaCodeError();
  }

  const [consumed] = await tx
    .update(mfaRecoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(mfaRecoveryCodes.userId, user.id),
        eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(normalized)),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id });

  if (!consumed) {
    throw new InvalidMfaCodeError();
  }

  return { method: "recovery", step: null };
}

async function findValidChallenge(
  db: DbExecutor,
  rawToken: string,
  now: Date,
): Promise<{ id: string; userId: string; expiresAt: Date }> {
  if (!rawToken) {
    throw new MfaChallengeInvalidError();
  }

  const [challenge] = await db
    .select({
      id: mfaChallenges.id,
      userId: mfaChallenges.userId,
      expiresAt: mfaChallenges.expiresAt,
    })
    .from(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.tokenHash, hashToken(rawToken)),
        isNull(mfaChallenges.usedAt),
        gt(mfaChallenges.expiresAt, now),
      ),
    )
    .limit(1);

  if (!challenge) {
    throw new MfaChallengeInvalidError();
  }

  return challenge;
}

async function loadChallengeUser(
  db: DbExecutor,
  userId: string,
): Promise<UserRow> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (
    !user ||
    user.accountStatus !== "active" ||
    !user.mfaEnabledAt ||
    !user.mfaTotpSecret
  ) {
    throw new MfaChallengeInvalidError();
  }

  return user;
}

/**
 * Creates a short-lived second-factor challenge. Only the token hash is stored.
 */
export async function issueMfaChallenge(
  db: DbExecutor,
  userId: string,
  options: { reason: string; now?: Date },
): Promise<MfaChallengeIssue> {
  const now = options.now ?? new Date();
  const token = generateSecureToken();
  const expiresAt = new Date(
    now.getTime() + MFA_CHALLENGE_TTL_SECONDS * 1000,
  );

  await db.insert(mfaChallenges).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    createdAt: now,
  });

  await writeAuditLog(db, {
    action: "mfa_challenge_issued",
    entityType: "auth",
    entityId: userId,
    details: { reason: options.reason },
  });

  return { token, expiresAt };
}

/**
 * Completes a password-login or password-reset MFA challenge exactly once.
 */
export async function completeMfaChallenge(
  db: DbClient,
  input: {
    challengeToken: string;
    code: string;
    ipHash?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<AuthResult> {
  const now = input.now ?? new Date();
  const challenge = await findValidChallenge(
    db,
    input.challengeToken,
    now,
  );
  const user = await loadChallengeUser(db, challenge.userId);
  const actor = mfaActor(user);

  await enforceMfaRateLimit(db, {
    key: `mfa-challenge:${challenge.id}`,
    limit: MFA_CHALLENGE_LIMIT,
    windowSeconds: MFA_CHALLENGE_WINDOW_SECONDS,
    now,
    scope: "challenge",
    actor,
  });
  await enforceMfaRateLimit(db, {
    key: `mfa-account:${user.id}`,
    limit: MFA_ACCOUNT_LIMIT,
    windowSeconds: MFA_ACCOUNT_WINDOW_SECONDS,
    now,
    scope: "account",
    actor,
  });

  try {
    const result = await db.transaction(async (tx) => {
      const [lockedChallenge] = await tx
        .select()
        .from(mfaChallenges)
        .where(
          and(
            eq(mfaChallenges.id, challenge.id),
            isNull(mfaChallenges.usedAt),
            gt(mfaChallenges.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);

      if (!lockedChallenge) {
        throw new MfaChallengeInvalidError();
      }

      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for("update")
        .limit(1);

      if (
        !lockedUser ||
        lockedUser.accountStatus !== "active" ||
        !lockedUser.mfaEnabledAt ||
        !lockedUser.mfaTotpSecret
      ) {
        throw new MfaChallengeInvalidError();
      }

      const factor = await consumeSecondFactor(
        tx,
        lockedUser,
        input.code,
        now,
      );

      const marked = await tx
        .update(mfaChallenges)
        .set({ usedAt: now })
        .where(
          and(
            eq(mfaChallenges.id, lockedChallenge.id),
            isNull(mfaChallenges.usedAt),
          ),
        )
        .returning({ id: mfaChallenges.id });

      if (marked.length === 0) {
        throw new MfaChallengeInvalidError();
      }

      const [updatedUser] = await tx
        .update(users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, lockedUser.id))
        .returning();

      if (!updatedUser) {
        throw new MfaChallengeInvalidError();
      }

      const session = await createSession(
        tx,
        lockedUser.id,
        { ipHash: input.ipHash, userAgent: input.userAgent },
        now,
      );

      await writeAuditLog(tx, {
        actor,
        action: "user_login",
        entityType: "session",
        entityId: lockedUser.id,
        details: {
          role: lockedUser.role,
          mfa: true,
          method: factor.method,
        },
      });
      await writeAuditLog(tx, {
        actor,
        action: "mfa_challenge_succeeded",
        entityType: "auth",
        entityId: lockedUser.id,
        details: { method: factor.method },
      });

      if (factor.method === "recovery") {
        const remaining = await remainingRecoveryCodes(tx, lockedUser.id);
        await writeAuditLog(tx, {
          actor,
          action: "mfa_recovery_code_used",
          entityType: "auth",
          entityId: lockedUser.id,
          details: { remaining },
        });
      }

      return { user: publicUser(updatedUser), session };
    });

    await Promise.allSettled([
      resetRateLimit(db, `mfa-challenge:${challenge.id}`),
      resetRateLimit(db, `mfa-account:${user.id}`),
    ]);

    return result;
  } catch (error) {
    if (error instanceof InvalidMfaCodeError) {
      await auditMfaFailure(db, actor, "mfa_challenge_failed", input.code);
    }
    throw error;
  }
}

export async function getMfaStatus(
  db: DbExecutor,
  userId: string,
): Promise<MfaStatus> {
  const [user] = await db
    .select({
      role: users.role,
      mfaEnabledAt: users.mfaEnabledAt,
      mfaTotpSecret: users.mfaTotpSecret,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  return {
    enabled: user.mfaEnabledAt !== null,
    enabledAt: user.mfaEnabledAt,
    pending: user.mfaEnabledAt === null && user.mfaTotpSecret !== null,
    recoveryCodesRemaining: await remainingRecoveryCodes(db, userId),
    required: user.role === "admin" && isMfaRequiredForAdmins(),
  };
}

export async function getMfaEnrollmentSetup(
  db: DbExecutor,
  userId: string,
): Promise<MfaEnrollmentSetup | null> {
  const user = await requireActiveActor(db, userId);
  if (user.mfaEnabledAt || !user.mfaTotpSecret) {
    return null;
  }

  try {
    const secret = decryptTotpSecret(user.mfaTotpSecret);
    return {
      secret,
      otpauthUrl: buildTotpProvisioningUri(user.email, secret),
    };
  } catch (error) {
    logger.error("mfa.pending_secret_decrypt_failed", {
      context: { userId: user.id },
      error,
      includeErrorDetails: false,
    });
    return null;
  }
}

export async function beginMfaEnrollment(
  db: DbClient,
  input: { actorId: string; now?: Date },
): Promise<MfaEnrollmentSetup> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  if (actor.mfaEnabledAt) {
    throw new ConflictError("Multi-factor authentication is already enabled.");
  }

  await enforceMfaRateLimit(db, {
    key: `mfa-enroll:${actor.id}`,
    limit: MFA_ENROLL_LIMIT,
    windowSeconds: MFA_ENROLL_WINDOW_SECONDS,
    now,
    scope: "enrollment",
    actor: mfaActor(actor),
  });

  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({
      mfaTotpSecret: encryptTotpSecret(secret),
      mfaLastUsedStep: null,
      updatedAt: now,
    })
    .where(eq(users.id, actor.id));

  await writeAuditLog(db, {
    actor: mfaActor(actor),
    action: "mfa_enrollment_started",
    entityType: "user",
    entityId: actor.id,
  });

  return {
    secret,
    otpauthUrl: buildTotpProvisioningUri(actor.email, secret),
  };
}

export async function cancelMfaEnrollment(
  db: DbClient,
  input: { actorId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  if (actor.mfaEnabledAt) {
    throw new ConflictError(
      "Multi-factor authentication is already enabled.",
    );
  }
  if (!actor.mfaTotpSecret) return;

  await db
    .update(users)
    .set({ mfaTotpSecret: null, mfaLastUsedStep: null, updatedAt: now })
    .where(eq(users.id, actor.id));

  await writeAuditLog(db, {
    actor: mfaActor(actor),
    action: "mfa_enrollment_cancelled",
    entityType: "user",
    entityId: actor.id,
  });
}

export async function confirmMfaEnrollment(
  db: DbClient,
  input: {
    actorId: string;
    code: string;
    currentSessionId?: string;
    now?: Date;
  },
): Promise<MfaRecoveryCodeSet> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  if (actor.mfaEnabledAt) {
    throw new ConflictError("Multi-factor authentication is already enabled.");
  }
  if (!actor.mfaTotpSecret) {
    throw new ConflictError(
      "Start authenticator setup before entering a code.",
    );
  }

  await enforceMfaRateLimit(db, {
    key: `mfa-enroll-confirm:${actor.id}`,
    limit: MFA_ENROLL_LIMIT,
    windowSeconds: MFA_ENROLL_WINDOW_SECONDS,
    now,
    scope: "enrollment_confirm",
    actor: mfaActor(actor),
  });

  const encryptedSecret = actor.mfaTotpSecret;
  let pendingSecret: string;
  try {
    pendingSecret = decryptTotpSecret(encryptedSecret);
  } catch {
    throw new ConflictError(
      "The pending authenticator setup could not be read. Start setup again.",
    );
  }

  const initialVerification = verifyTotpCode(pendingSecret, input.code, {
    now,
  });
  if (!initialVerification.valid) {
    await auditMfaFailure(
      db,
      mfaActor(actor),
      "mfa_enrollment_failed",
      input.code,
    );
    throw new InvalidMfaCodeError(
      initialVerification.reason === "replay"
        ? "That code was already used. Wait for a new code."
        : "That code is not valid. Check your authenticator app and try again.",
    );
  }

  const recoveryCodes = generateRecoveryCodes();
  const codeHashes = recoveryCodes.map(hashRecoveryCode);

  const result = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update")
      .limit(1);

    if (!locked || locked.mfaEnabledAt) {
      throw new ConflictError(
        "Multi-factor authentication is already enabled.",
      );
    }
    if (
      !locked.mfaTotpSecret ||
      locked.mfaTotpSecret !== encryptedSecret
    ) {
      throw new ConflictError(
        "The setup was restarted. Scan the newest QR code and try again.",
      );
    }

    const verification = verifyTotpCode(pendingSecret, input.code, {
      now,
      lastUsedStep: locked.mfaLastUsedStep,
    });
    if (!verification.valid) {
      throw new InvalidMfaCodeError(
        verification.reason === "replay"
          ? "That code was already used. Wait for a new code."
          : "That code is not valid. Check your authenticator app and try again.",
      );
    }

    await tx
      .update(users)
      .set({
        mfaEnabledAt: now,
        mfaLastUsedStep: verification.step,
        updatedAt: now,
      })
      .where(eq(users.id, locked.id));

    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, locked.id));
    await tx.insert(mfaRecoveryCodes).values(
      codeHashes.map((codeHash) => ({
        userId: locked.id,
        codeHash,
        createdAt: now,
      })),
    );

    await tx
      .delete(mfaChallenges)
      .where(eq(mfaChallenges.userId, locked.id));

    if (input.currentSessionId) {
      await revokeOtherUserSessions(
        tx,
        locked.id,
        input.currentSessionId,
        now,
      );
    }

    await writeAuditLog(tx, {
      actor: mfaActor(locked),
      action: "mfa_enabled",
      entityType: "user",
      entityId: locked.id,
      details: { recoveryCodes: recoveryCodes.length },
    });

    return { recoveryCodes };
  });

  await resetRateLimit(db, `mfa-enroll-confirm:${actor.id}`);
  return result;
}

export async function regenerateRecoveryCodes(
  db: DbClient,
  input: {
    actorId: string;
    code: string;
    now?: Date;
  },
): Promise<MfaRecoveryCodeSet> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  if (!actor.mfaEnabledAt) {
    throw new ConflictError("Multi-factor authentication is not enabled.");
  }

  await enforceMfaRateLimit(db, {
    key: `mfa-manage:${actor.id}`,
    limit: MFA_MANAGE_LIMIT,
    windowSeconds: MFA_MANAGE_WINDOW_SECONDS,
    now,
    scope: "recovery_regenerate",
    actor: mfaActor(actor),
  });

  const recoveryCodes = generateRecoveryCodes();
  const codeHashes = recoveryCodes.map(hashRecoveryCode);

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actor.id))
        .for("update")
        .limit(1);

      if (!locked || !locked.mfaEnabledAt) {
        throw new ConflictError(
          "Multi-factor authentication is not enabled.",
        );
      }

      const factor = await consumeSecondFactor(tx, locked, input.code, now);
      const remaining =
        factor.method === "recovery"
          ? await remainingRecoveryCodes(tx, locked.id)
          : null;

      await tx
        .delete(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.userId, locked.id));
      await tx.insert(mfaRecoveryCodes).values(
        codeHashes.map((codeHash) => ({
          userId: locked.id,
          codeHash,
          createdAt: now,
        })),
      );

      await tx
        .update(users)
        .set({ updatedAt: now })
        .where(eq(users.id, locked.id));

      await writeAuditLog(tx, {
        actor: mfaActor(locked),
        action: "mfa_recovery_codes_regenerated",
        entityType: "auth",
        entityId: locked.id,
        details: {
          count: recoveryCodes.length,
          method: factor.method,
        },
      });

      if (factor.method === "recovery") {
        await writeAuditLog(tx, {
          actor: mfaActor(locked),
          action: "mfa_recovery_code_used",
          entityType: "auth",
          entityId: locked.id,
          details: { remaining: remaining ?? 0 },
        });
      }

      return { recoveryCodes };
    });

    await resetRateLimit(db, `mfa-manage:${actor.id}`);
    return result;
  } catch (error) {
    if (error instanceof InvalidMfaCodeError) {
      await auditMfaFailure(
        db,
        mfaActor(actor),
        "mfa_recovery_regenerate_failed",
        input.code,
      );
    }
    throw error;
  }
}

export async function disableMfa(
  db: DbClient,
  input: {
    actorId: string;
    password: string;
    code: string;
    currentSessionId?: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  if (!actor.mfaEnabledAt) {
    throw new ConflictError("Multi-factor authentication is not enabled.");
  }
  if (!actor.passwordHash) {
    throw new ConflictError("Set a password before changing MFA.");
  }

  await enforceMfaRateLimit(db, {
    key: `mfa-disable:${actor.id}`,
    limit: MFA_MANAGE_LIMIT,
    windowSeconds: MFA_MANAGE_WINDOW_SECONDS,
    now,
    scope: "disable",
    actor: mfaActor(actor),
  });

  const passwordValid = await verifyPassword(
    actor.passwordHash,
    input.password,
  );
  if (!passwordValid) {
    throw new ValidationError("Current password is incorrect.", {
      password: ["Current password is incorrect."],
    });
  }

  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actor.id))
        .for("update")
        .limit(1);

      if (!locked || !locked.mfaEnabledAt) {
        throw new ConflictError(
          "Multi-factor authentication is not enabled.",
        );
      }

      const factor = await consumeSecondFactor(tx, locked, input.code, now);
      const remaining =
        factor.method === "recovery"
          ? await remainingRecoveryCodes(tx, locked.id)
          : null;

      await tx
        .update(users)
        .set({
          mfaEnabledAt: null,
          mfaTotpSecret: null,
          mfaLastUsedStep: null,
          updatedAt: now,
        })
        .where(eq(users.id, locked.id));

      await tx
        .delete(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.userId, locked.id));
      await tx
        .delete(mfaChallenges)
        .where(eq(mfaChallenges.userId, locked.id));

      if (input.currentSessionId) {
        await revokeOtherUserSessions(
          tx,
          locked.id,
          input.currentSessionId,
          now,
        );
      }

      await writeAuditLog(tx, {
        actor: mfaActor(locked),
        action: "mfa_disabled",
        entityType: "user",
        entityId: locked.id,
        details: { method: factor.method },
      });

      if (factor.method === "recovery") {
        await writeAuditLog(tx, {
          actor: mfaActor(locked),
          action: "mfa_recovery_code_used",
          entityType: "auth",
          entityId: locked.id,
          details: { remaining: remaining ?? 0 },
        });
      }
    });
  } catch (error) {
    if (error instanceof InvalidMfaCodeError) {
      await auditMfaFailure(
        db,
        mfaActor(actor),
        "mfa_disable_failed",
        input.code,
      );
    }
    throw error;
  }

  await resetRateLimit(db, `mfa-disable:${actor.id}`);
}
