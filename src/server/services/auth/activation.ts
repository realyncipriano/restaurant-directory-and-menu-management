import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession, revokeAllUserSessions } from "@/lib/auth/session";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { activateSchema } from "@/lib/validation/auth";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "../audit";
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

export async function getActivationContext(
  db: DbClient,
  rawToken: string,
  now = new Date(),
): Promise<{
  kind: "invite" | "password_reset";
  email: string;
  name: string;
  expiresAt: Date;
} | null> {
  const row = await findUsableToken(
    db,
    rawToken,
    ["invite", "password_reset"],
    now,
  );
  if (!row) return null;

  return {
    kind: row.purpose,
    email: row.email,
    name: row.name,
    expiresAt: row.expiresAt,
  };
}

export async function activateAccount(
  db: DbClient,
  input: {
    token: string;
    name: string;
    password: string;
    confirmPassword: string;
    ipHash?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<AuthResult> {
  const now = input.now ?? new Date();
  const parsed = parseOrThrow(activateSchema, input);
  assertStrongPassword(parsed.password);
  await enforceActivationRateLimit(db, input.ipHash, now);

  const context = await findUsableToken(db, parsed.token, ["invite"], now);
  if (!context) {
    throw new NotFoundError("This invitation link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(parsed.password);
  const sessionMeta: SessionMeta = {
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  };

  return db.transaction(async (tx) => {
    const marked = await markTokenUsed(tx, context.tokenId, now);
    if (!marked) {
      throw new ConflictError("This invitation has already been used.");
    }

    const [updated] = await tx
      .update(users)
      .set({
        name: parsed.name,
        passwordHash,
        accountStatus: "active",
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, context.userId),
          eq(users.accountStatus, "invited"),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictError("This invitation can no longer be activated.");
    }

    await invalidateUserTokens(tx, context.userId, now);
    await revokeAllUserSessions(tx, context.userId, now);
    const session = await createSession(tx, updated.id, sessionMeta, now);

    await writeAuditLog(tx, {
      actor: { id: updated.id, email: updated.email },
      action: "user_activated",
      entityType: "user",
      entityId: updated.id,
      details: { role: updated.role },
    });

    return { user: publicUser(updated), session };
  });
}
