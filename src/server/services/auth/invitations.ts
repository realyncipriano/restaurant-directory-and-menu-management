import { eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { users } from "@/db/schema";
import { ConflictError } from "@/lib/errors";
import { inviteSchema } from "@/lib/validation/auth";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "../audit";
import { requireAdminActor } from "./actors";
import {
  INVITE_TTL_MS,
  activationUrl,
  addMs,
  publicUser,
  type PublicUser,
} from "./shared";
import { invalidateUserTokens, issueToken } from "./token-store";

export async function createInvite(
  db: DbClient,
  input: {
    actorId: string;
    email: string;
    name?: string;
    now?: Date;
  },
): Promise<{ token: string; url: string; user: PublicUser }> {
  const now = input.now ?? new Date();
  const actor = await requireAdminActor(db, input.actorId);
  const parsed = parseOrThrow(inviteSchema, {
    email: input.email,
    name: input.name,
  });

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${parsed.email}`)
    .limit(1);

  if (existing) {
    const canRenewInvite =
      existing.role === "authorized_user" &&
      (existing.accountStatus === "invited" ||
        (existing.accountStatus === "deactivated" && !existing.passwordHash));
    if (!canRenewInvite) {
      throw new ConflictError("An account with that email already exists.");
    }

    const [renewed] = await db
      .update(users)
      .set({
        name: parsed.name ?? existing.name,
        accountStatus: "invited",
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning();

    await invalidateUserTokens(db, existing.id, now);
    const token = await issueToken(db, {
      userId: existing.id,
      purpose: "invite",
      createdBy: actor.id,
      expiresAt: addMs(now, INVITE_TTL_MS),
      now,
    });

    await writeAuditLog(db, {
      actor: { id: actor.id, email: actor.email },
      action: "user_invited",
      entityType: "user",
      entityId: existing.id,
      details: { email: existing.email, renewed: true },
    });

    return {
      token,
      url: activationUrl(token),
      user: publicUser(renewed ?? existing),
    };
  }

  const fallbackName = parsed.email.split("@")[0] || "Team member";

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        name: parsed.name ?? fallbackName,
        email: parsed.email,
        role: "authorized_user",
        accountStatus: "invited",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const token = await issueToken(tx, {
      userId: user.id,
      purpose: "invite",
      createdBy: actor.id,
      expiresAt: addMs(now, INVITE_TTL_MS),
      now,
    });

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "user_invited",
      entityType: "user",
      entityId: user.id,
      details: { email: user.email, renewed: false },
    });

    return { user, token };
  });

  return {
    token: created.token,
    url: activationUrl(created.token),
    user: publicUser(created.user),
  };
}
