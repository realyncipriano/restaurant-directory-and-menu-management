import { and, eq, gt, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { consumeRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import {
  InvalidMfaCodeError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { writeAuditLog } from "../audit";
import { requireActiveActor } from "./actors";
import { consumeSecondFactor } from "./mfa";

const STEP_UP_LIMIT = 5;
const STEP_UP_WINDOW_SECONDS = 15 * 60;

export type StepUpMethod = "password" | "totp" | "recovery";

/**
 * Re-verifies the signed-in user and marks the current session as recently
 * stepped up. Password verification is required even for MFA accounts, so a
 * stolen session cannot be promoted to step-up access on its own.
 */
export async function verifyStepUp(
  db: DbClient,
  input: {
    actorId: string;
    sessionId: string;
    password: string;
    code?: string;
    now?: Date;
  },
): Promise<{ method: StepUpMethod }> {
  const now = input.now ?? new Date();
  const actor = await requireActiveActor(db, input.actorId);
  const actorRef = { id: actor.id, email: actor.email };

  const limit = await consumeRateLimit(db, {
    key: `step-up:${actor.id}`,
    limit: STEP_UP_LIMIT,
    windowSeconds: STEP_UP_WINDOW_SECONDS,
    now,
  });
  if (!limit.allowed) {
    if (limit.count === STEP_UP_LIMIT + 1) {
      await writeAuditLog(db, {
        actor: actorRef,
        action: "step_up_rate_limited",
        entityType: "auth",
        entityId: actor.id,
        details: { scope: "step_up" },
      });
    }
    throw new RateLimitedError(limit.retryAfterSeconds);
  }

  const passwordValid = await verifyPassword(
    actor.passwordHash ?? "",
    input.password,
  );
  if (!passwordValid) {
    await writeAuditLog(db, {
      actor: actorRef,
      action: "step_up_failed",
      entityType: "auth",
      entityId: actor.id,
      details: { reason: "password" },
    });
    throw new ValidationError("Current password is incorrect.", {
      password: ["Current password is incorrect."],
    });
  }

  let method: StepUpMethod = "password";

  try {
    method = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actor.id))
        .for("update")
        .limit(1);

      if (!lockedUser || lockedUser.accountStatus !== "active") {
        throw new UnauthenticatedError();
      }

      let factorMethod: StepUpMethod = "password";
      if (lockedUser.mfaEnabledAt) {
        if (!input.code?.trim()) {
          throw new InvalidMfaCodeError(
            "Enter an authenticator code or recovery code.",
          );
        }
        const factor = await consumeSecondFactor(
          tx,
          lockedUser,
          input.code,
          now,
        );
        factorMethod = factor.method;
      }

      const updated = await tx
        .update(sessions)
        .set({ steppedUpAt: now })
        .where(
          and(
            eq(sessions.id, input.sessionId),
            eq(sessions.userId, lockedUser.id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        )
        .returning({ id: sessions.id });

      if (updated.length === 0) {
        throw new UnauthenticatedError();
      }

      await writeAuditLog(tx, {
        actor: actorRef,
        action: "step_up_succeeded",
        entityType: "session",
        entityId: input.sessionId,
        details: {
          method: factorMethod,
          mfa: lockedUser.mfaEnabledAt !== null,
        },
      });

      return factorMethod;
    });
  } catch (error) {
    if (error instanceof InvalidMfaCodeError) {
      await writeAuditLog(db, {
        actor: actorRef,
        action: "step_up_failed",
        entityType: "auth",
        entityId: actor.id,
        details: {
          reason: "mfa",
          method: /^\d{6}$/u.test(input.code?.replace(/\s+/g, "") ?? "")
            ? "totp"
            : "recovery",
        },
      });
    }
    throw error;
  }

  await resetRateLimit(db, `step-up:${actor.id}`);
  return { method };
}
