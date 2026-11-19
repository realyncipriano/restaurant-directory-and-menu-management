import { eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { users } from "@/db/schema";
import { ConflictError } from "@/lib/errors";
import { inviteSchema } from "@/lib/validation/auth";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "../audit";
import {
  lockAdminMembership,
  requireAdminActorForUpdate,
} from "./admin-membership";
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
  await requireAdminActor(db, input.actorId);
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

    return db.transaction(async (tx) => {
      await lockAdminMembership(tx);
      const actor = await requireAdminActorForUpdate(tx, input.actorId);

      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, existing.id))
        .for("update")
        .limit(1);

      // Recheck eligibility after acquiring the row lock. A concurrent
      // deactivation or role change may have landed while we waited.
      if (!locked) {
        throw new ConflictError("An account with that email already exists.");
      }
      const stillEligible =
        locked.role === "authorized_user" &&
        (locked.accountStatus === "invited" ||
          (locked.accountStatus === "deactivated" && !locked.passwordHash));
      if (!stillEligible) {
        throw new ConflictError("An account with that email already exists.");
      }

      const [renewed] = await tx
        .update(users)
        .set({
          name: parsed.name ?? locked.name,
          accountStatus: "invited",
          updatedAt: now,
        })
        .where(eq(users.id, locked.id))
        .returning();

      await invalidateUserTokens(tx, locked.id, now);
      const token = await issueToken(tx, {
        userId: locked.id,
        purpose: "invite",
        createdBy: actor.id,
        expiresAt: addMs(now, INVITE_TTL_MS),
        now,
      });

      await writeAuditLog(tx, {
        actor: { id: actor.id, email: actor.email },
        action: "user_invited",
        entityType: "user",
        entityId: locked.id,
        details: { email: locked.email, renewed: true },
      });

      return {
        token,
        url: activationUrl(token),
        user: publicUser(renewed ?? locked),
      };
    });
  }

  const fallbackName = parsed.email.split("@")[0] || "Team member";

  const created = await db.transaction(async (tx) => {
    await lockAdminMembership(tx);
    const actor = await requireAdminActorForUpdate(tx, input.actorId);

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
