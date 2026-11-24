import { and, eq, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  authTokens,
  mfaChallenges,
  mfaRecoveryCodes,
  sessions,
  users,
} from "@/db/schema";
import {
  generateSecureToken,
  hashTokenWithSecret,
} from "@/lib/auth/token-crypto";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { parseRecoveryAppUrl } from "@/lib/recovery-url";
import { writeAuditLog } from "../audit";

export const ADMIN_RECOVERY_TTL_MS = 60 * 60 * 1000;

export type AdminRecoveryLink = {
  url: string;
  expiresAt: Date;
  user: { id: string; email: string };
};

function normalizedAppUrl(
  appUrl: string,
  allowDevelopmentUrl: boolean | undefined,
): string {
  try {
    return parseRecoveryAppUrl(appUrl, { allowDevelopmentUrl });
  } catch (error) {
    throw new ValidationError(
      error instanceof Error
        ? error.message
        : "APP_URL must be an absolute URL.",
    );
  }
}

/**
 * Break-glass recovery for an existing active administrator.
 *
 * This service is intentionally not exported from the application auth barrel
 * and has no web route. Its trust boundary is possession of direct database
 * credentials and AUTH_SECRET (the same boundary required to run migrations or
 * the bootstrap seed command). It never promotes, invites, or reactivates.
 */
export async function createAdminRecoveryLink(
  db: DbClient,
  input: {
    email: string;
    appUrl: string;
    authSecret: string;
    allowDevelopmentUrl?: boolean;
    disableMfa?: boolean;
    now?: Date;
  },
): Promise<AdminRecoveryLink> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new ValidationError("An administrator email is required.");
  }
  if (input.authSecret.length < 32) {
    throw new ValidationError("AUTH_SECRET must be at least 32 characters.");
  }
  const appUrl = normalizedAppUrl(
    input.appUrl,
    input.allowDevelopmentUrl,
  );
  const expiresAt = new Date(now.getTime() + ADMIN_RECOVERY_TTL_MS);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update")
      .limit(1);

    if (!target) {
      throw new NotFoundError("No account exists with that email.");
    }
    if (
      target.role !== "admin" ||
      target.accountStatus !== "active" ||
      !target.passwordHash
    ) {
      throw new ConflictError(
        "Recovery requires an existing active administrator account with a password.",
      );
    }

    if (input.disableMfa && target.mfaEnabledAt) {
      await tx
        .update(users)
        .set({
          mfaEnabledAt: null,
          mfaTotpSecret: null,
          mfaLastUsedStep: null,
          updatedAt: now,
        })
        .where(eq(users.id, target.id));
      await tx
        .delete(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.userId, target.id));
      await tx
        .delete(mfaChallenges)
        .where(eq(mfaChallenges.userId, target.id));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(sessions.userId, target.id),
            isNull(sessions.revokedAt),
          ),
        );

      await writeAuditLog(tx, {
        actor: null,
        action: "admin_recovery_mfa_reset",
        entityType: "user",
        entityId: target.id,
        details: { email: target.email, source: "cli" },
      });
    }

    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.userId, target.id),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.usedAt),
        ),
      );

    const token = generateSecureToken();
    await tx.insert(authTokens).values({
      userId: target.id,
      purpose: "password_reset",
      tokenHash: hashTokenWithSecret(input.authSecret, token),
      expiresAt,
      createdBy: null,
      createdAt: now,
    });

    await writeAuditLog(tx, {
      actor: null,
      action: "admin_recovery_link_created",
      entityType: "user",
      entityId: target.id,
      details: { email: target.email, source: "cli" },
    });

    return {
      url: `${appUrl}/activate?token=${encodeURIComponent(token)}`,
      expiresAt,
      user: { id: target.id, email: target.email },
    };
  });
}
