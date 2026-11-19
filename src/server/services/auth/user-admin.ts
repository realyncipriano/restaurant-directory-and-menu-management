import { and, count, eq, inArray, sql } from "drizzle-orm";

import type { DbClient, DbTransaction } from "@/db/client";
import { users } from "@/db/schema";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizeUuid } from "@/lib/validation/ids";
import { writeAuditLog } from "../audit";
import {
  lockAdminMembership,
  requireAdminActorForUpdate,
} from "./admin-membership";
import { requireAdminActor } from "./actors";
import {
  RESET_TTL_MS,
  activationUrl,
  addMs,
  publicUser,
  type PublicUser,
} from "./shared";
import {
  invalidatePasswordResetTokens,
  invalidateUserTokens,
  issueToken,
} from "./token-store";

export type SetUserRoleResult = {
  user: PublicUser;
  changed: boolean;
};

export type DeactivateUserResult = {
  changed: boolean;
};

async function requireAnotherActiveAdministrator(
  tx: DbTransaction,
): Promise<void> {
  await tx.execute(
    sql`select id from ${users} where ${users.role} = 'admin' and ${users.accountStatus} = 'active' for update`,
  );
  const [row] = await tx
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
  if ((row?.total ?? 0) <= 1) {
    throw new ConflictError(
      "At least one active administrator is required.",
      "last_admin",
    );
  }
}

export async function createPasswordResetLink(
  db: DbClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<{ token: string; url: string }> {
  const now = input.now ?? new Date();
  const userId = normalizeUuid(input.userId);
  if (!userId) {
    throw new NotFoundError("User not found.");
  }

  return db.transaction(async (tx) => {
    await lockAdminMembership(tx);
    const actor = await requireAdminActorForUpdate(tx, input.actorId);

    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);

    if (!target) {
      throw new NotFoundError("User not found.");
    }
    if (target.accountStatus !== "active" || !target.passwordHash) {
      throw new ConflictError(
        "This account is not active. Send a new invitation instead.",
      );
    }

    await invalidatePasswordResetTokens(tx, target.id, now);

    const token = await issueToken(tx, {
      userId: target.id,
      purpose: "password_reset",
      createdBy: actor.id,
      expiresAt: addMs(now, RESET_TTL_MS),
      now,
    });

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "password_reset_link_created",
      entityType: "user",
      entityId: target.id,
      details: { email: target.email },
    });

    return { token, url: activationUrl(token) };
  });
}

export async function deactivateUser(
  db: DbClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<DeactivateUserResult> {
  const now = input.now ?? new Date();
  const userId = normalizeUuid(input.userId);
  if (!userId) {
    throw new NotFoundError("User not found.");
  }

  const actor = await requireAdminActor(db, input.actorId);

  if (actor.id === userId) {
    throw new ConflictError("You cannot deactivate your own account.", "self");
  }

  return db.transaction(async (tx) => {
    await lockAdminMembership(tx);
    const currentActor = await requireAdminActorForUpdate(tx, input.actorId);

    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);

    if (!target) {
      throw new NotFoundError("User not found.");
    }
    if (currentActor.id === target.id) {
      throw new ConflictError(
        "You cannot deactivate your own account.",
        "self",
      );
    }
    if (target.accountStatus === "deactivated") {
      return { changed: false };
    }

    if (target.accountStatus === "active" && target.role === "admin") {
      await requireAnotherActiveAdministrator(tx);
    }

    const [updated] = await tx
      .update(users)
      .set({ accountStatus: "deactivated", updatedAt: now })
      .where(
        and(
          eq(users.id, target.id),
          inArray(users.accountStatus, ["active", "invited"]),
        ),
      )
      .returning({ id: users.id });
    if (!updated) {
      throw new ConflictError("This account is no longer active.", "state");
    }

    await revokeAllUserSessions(tx, target.id, now);
    await invalidateUserTokens(tx, target.id, now);
    await writeAuditLog(tx, {
      actor: { id: currentActor.id, email: currentActor.email },
      action: "user_deactivated",
      entityType: "user",
      entityId: target.id,
      details: { email: target.email },
    });

    return { changed: true };
  });
}

export async function setUserRole(
  db: DbClient,
  input: {
    actorId: string;
    userId: string;
    role: string;
    now?: Date;
  },
): Promise<SetUserRoleResult> {
  const now = input.now ?? new Date();
  const userId = normalizeUuid(input.userId);
  if (!userId) {
    throw new NotFoundError("User not found.");
  }

  const actor = await requireAdminActor(db, input.actorId);

  if (input.role !== "admin" && input.role !== "authorized_user") {
    throw new ValidationError("Choose a valid role.");
  }
  if (actor.id === userId) {
    throw new ConflictError("You cannot change your own role.", "self");
  }

  const role = input.role;

  return db.transaction(async (tx) => {
    await lockAdminMembership(tx);
    const currentActor = await requireAdminActorForUpdate(tx, input.actorId);

    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);

    if (!target) {
      throw new NotFoundError("User not found.");
    }
    if (currentActor.id === target.id) {
      throw new ConflictError("You cannot change your own role.", "self");
    }
    if (target.accountStatus !== "active") {
      throw new ConflictError(
        "Activate or reactivate the account first.",
        "inactive",
      );
    }
    if (!target.passwordHash) {
      throw new ConflictError(
        "This account cannot be changed until it has a password.",
        "passwordless",
      );
    }
    if (target.role === role) {
      return { user: publicUser(target), changed: false };
    }

    if (target.role === "admin" && role === "authorized_user") {
      await requireAnotherActiveAdministrator(tx);
    }

    const [updated] = await tx
      .update(users)
      .set({ role, updatedAt: now })
      .where(eq(users.id, target.id))
      .returning();
    if (!updated) {
      throw new ConflictError("This account no longer exists.", "state");
    }

    await writeAuditLog(tx, {
      actor: { id: currentActor.id, email: currentActor.email },
      action: "user_role_changed",
      entityType: "user",
      entityId: target.id,
      details: {
        email: target.email,
        previousRole: target.role,
        newRole: role,
      },
    });

    return { user: publicUser(updated), changed: true };
  });
}

export async function reactivateUser(
  db: DbClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const userId = normalizeUuid(input.userId);
  if (!userId) {
    throw new NotFoundError("User not found.");
  }

  await db.transaction(async (tx) => {
    await lockAdminMembership(tx);
    const currentActor = await requireAdminActorForUpdate(tx, input.actorId);

    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);

    if (!target) {
      throw new NotFoundError("User not found.");
    }
    if (target.accountStatus !== "deactivated") {
      throw new ConflictError(
        "This account is not deactivated.",
        "not_deactivated",
      );
    }
    if (!target.passwordHash) {
      throw new ConflictError("Send a new invitation instead.", "passwordless");
    }

    // Defense in depth: never revive a token that survived deactivation or
    // was written while the account was inactive.
    await invalidateUserTokens(tx, target.id, now);

    await tx
      .update(users)
      .set({ accountStatus: "active", updatedAt: now })
      .where(eq(users.id, target.id));
    await writeAuditLog(tx, {
      actor: { id: currentActor.id, email: currentActor.email },
      action: "user_reactivated",
      entityType: "user",
      entityId: target.id,
      details: { email: target.email },
    });
  });
}

export async function listUsers(
  db: DbClient,
  actorId: string,
): Promise<PublicUser[]> {
  await requireAdminActor(db, actorId);
  const rows = await db
    .select()
    .from(users)
    .orderBy(users.createdAt);
  return rows.map(publicUser);
}
