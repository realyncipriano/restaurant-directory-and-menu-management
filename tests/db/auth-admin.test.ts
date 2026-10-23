import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { auditLogs, authTokens, sessions, users } from "@/db/schema";
import { getSessionUserByToken } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import {
  createInvite,
  createPasswordResetLink,
  deactivateUser,
  getActivationContext,
  listUsers,
  loginWithPassword,
  reactivateUser,
} from "@/server/services/auth";
import {
  openTestDb,
  resetTestDb,
  seedUser,
  TEST_PASSWORD,
} from "../helpers/db";
import type { EphemeralDb } from "./ephemeral-db";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("authentication administration services (ephemeral PGlite)", () => {
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

  it("persists only a hashed seven-day invitation token and audits creation", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "New.Member@example.com",
      now: NOW,
    });

    const [tokenRow] = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, invite.user.id));

    expect(tokenRow).toBeDefined();
    expect(tokenRow?.purpose).toBe("invite");
    expect(tokenRow?.tokenHash).toBe(hashToken(invite.token));
    expect(tokenRow?.tokenHash).not.toBe(invite.token);
    expect(tokenRow?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenRow?.expiresAt.getTime()).toBe(NOW.getTime() + INVITE_TTL_MS);
    expect(tokenRow?.createdAt.getTime()).toBe(NOW.getTime());
    expect(tokenRow?.usedAt).toBeNull();
    expect(tokenRow?.createdBy).toBe(admin.id);

    expect(invite.user.email).toBe("new.member@example.com");
    expect(invite.user.name).toBe("new.member");
    expect(invite.user.role).toBe("authorized_user");
    expect(invite.user.accountStatus).toBe("invited");
    expect(invite.url).toContain("/activate?token=");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_invited"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(admin.id);
    expect(audits[0]?.actorEmail).toBe("admin@example.com");
    expect(audits[0]?.entityType).toBe("user");
    expect(audits[0]?.entityId).toBe(invite.user.id);
    expect(audits[0]?.details).toEqual({
      email: "new.member@example.com",
      renewed: false,
    });
  });

  it("renews eligible invitations and rejects ineligible existing accounts", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const first = await createInvite(db, {
      actorId: admin.id,
      email: "renew@example.com",
      now: NOW,
    });
    const renewed = await createInvite(db, {
      actorId: admin.id,
      email: "RENEW@example.com",
      name: "Renewed Name",
      now: NOW,
    });

    expect(renewed.user.id).toBe(first.user.id);
    expect(renewed.user.name).toBe("Renewed Name");
    expect(renewed.token).not.toBe(first.token);
    expect(await getActivationContext(db, first.token, NOW)).toBeNull();
    expect(await getActivationContext(db, renewed.token, NOW)).not.toBeNull();

    const renewedAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_invited"));
    expect(renewedAudits).toHaveLength(2);
    expect(renewedAudits[1]?.details).toEqual({
      email: "renew@example.com",
      renewed: true,
    });

    const active = await seedUser(db, {
      email: "ACTIVE@example.com",
    });
    const deactivatedWithPassword = await seedUser(db, {
      email: "deactivated-password@example.com",
      status: "deactivated",
    });
    const invitedAdmin = await seedUser(db, {
      email: "invited-admin@example.com",
      role: "admin",
      status: "invited",
    });

    for (const email of [
      "active@example.com",
      deactivatedWithPassword.email,
      invitedAdmin.email,
    ]) {
      await expect(
        createInvite(db, {
          actorId: admin.id,
          email,
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "ConflictError",
        message: "An account with that email already exists.",
      });
    }

    expect(active.accountStatus).toBe("active");
    expect((await db.select().from(authTokens)).length).toBe(2);
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.action, "user_invited")),
    ).toHaveLength(2);
  });

  it("requires an active administrator to invite users or issue reset links", async () => {
    const member = await seedUser(db, { email: "member@example.com" });
    const invitedAdmin = await seedUser(db, {
      email: "invited-admin@example.com",
      role: "admin",
      status: "invited",
    });
    const deactivatedAdmin = await seedUser(db, {
      email: "deactivated-admin@example.com",
      role: "admin",
      status: "deactivated",
    });
    const target = await seedUser(db, { email: "target@example.com" });

    const unauthenticatedActors = [
      MISSING_ID,
      invitedAdmin.id,
      deactivatedAdmin.id,
    ];

    for (const actorId of unauthenticatedActors) {
      await expect(
        createInvite(db, {
          actorId,
          email: `blocked-${actorId}@example.com`,
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "UnauthenticatedError",
        message: "Authentication required.",
      });
      await expect(
        createPasswordResetLink(db, {
          actorId,
          userId: target.id,
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "UnauthenticatedError",
        message: "Authentication required.",
      });
    }

    for (const operation of [
      () =>
        createInvite(db, {
          actorId: member.id,
          email: "forbidden@example.com",
          now: NOW,
        }),
      () =>
        createPasswordResetLink(db, {
          actorId: member.id,
          userId: target.id,
          now: NOW,
        }),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "You do not have permission to perform this action.",
      });
    }

    expect(await db.select().from(users)).toHaveLength(4);
    expect(await db.select().from(authTokens)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("rotates reset tokens, stores hashes, preserves sessions, and audits issuance", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const login = await loginWithPassword(db, {
      email: "member@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });

    const first = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });
    expect(await getActivationContext(db, first.token, NOW)).not.toBeNull();

    const second = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    const tokenRows = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, member.id));
    const firstRow = tokenRows.find(
      (row) => row.tokenHash === hashToken(first.token),
    );
    const secondRow = tokenRows.find(
      (row) => row.tokenHash === hashToken(second.token),
    );

    expect(tokenRows).toHaveLength(2);
    expect(firstRow?.usedAt?.getTime()).toBe(NOW.getTime());
    expect(secondRow?.usedAt).toBeNull();
    expect(firstRow?.purpose).toBe("password_reset");
    expect(secondRow?.purpose).toBe("password_reset");
    expect(firstRow?.tokenHash).not.toBe(first.token);
    expect(secondRow?.tokenHash).not.toBe(second.token);
    expect(secondRow?.expiresAt.getTime()).toBe(NOW.getTime() + RESET_TTL_MS);
    expect(secondRow?.createdBy).toBe(admin.id);

    expect(await getActivationContext(db, first.token, NOW)).toBeNull();
    expect(await getActivationContext(db, second.token, NOW)).not.toBeNull();
    expect(await getSessionUserByToken(db, login.session.token, NOW)).not.toBeNull();

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "password_reset_link_created"));
    expect(audits).toHaveLength(2);
    expect(audits[0]?.actorId).toBe(admin.id);
    expect(audits[0]?.actorEmail).toBe("admin@example.com");
    expect(audits[0]?.details).toEqual({ email: "member@example.com" });
    expect(audits[1]?.details).toEqual({ email: "member@example.com" });
  });

  it("revokes sessions and tokens on deactivation, audits, and is idempotent", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const login = await loginWithPassword(db, {
      email: "member@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });
    const reset = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    await deactivateUser(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    expect(await getSessionUserByToken(db, login.session.token, NOW)).toBeNull();
    expect(await getActivationContext(db, reset.token, NOW)).toBeNull();

    const [resetRow] = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, member.id));
    expect(resetRow?.usedAt?.getTime()).toBe(NOW.getTime());

    const [memberRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, member.id));
    expect(memberRow?.accountStatus).toBe("deactivated");

    const firstAudits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_deactivated"));
    expect(firstAudits).toHaveLength(1);
    expect(firstAudits[0]?.actorId).toBe(admin.id);
    expect(firstAudits[0]?.actorEmail).toBe("admin@example.com");
    expect(firstAudits[0]?.entityType).toBe("user");
    expect(firstAudits[0]?.entityId).toBe(member.id);
    expect(firstAudits[0]?.details).toEqual({ email: "member@example.com" });

    await expect(
      deactivateUser(db, {
        actorId: admin.id,
        userId: member.id,
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    expect(
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "user_deactivated")),
    ).toHaveLength(1);
  });

  it("invalidates a pending invitation when an invited user is deactivated", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "invited@example.com",
      now: NOW,
    });

    expect(await getActivationContext(db, invite.token, NOW)).not.toBeNull();

    await deactivateUser(db, {
      actorId: admin.id,
      userId: invite.user.id,
      now: NOW,
    });

    expect(await getActivationContext(db, invite.token, NOW)).toBeNull();

    const [tokenRow] = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, invite.user.id));
    expect(tokenRow?.usedAt?.getTime()).toBe(NOW.getTime());

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, invite.user.id));
    expect(userRow?.accountStatus).toBe("deactivated");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_deactivated"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityId).toBe(invite.user.id);
  });

  it("preserves exact self, last-admin, missing-target, and authorization errors", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const invitedAdmin = await seedUser(db, {
      email: "invited-admin@example.com",
      role: "admin",
      status: "invited",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const victim = await seedUser(db, { email: "victim@example.com" });

    await expect(
      deactivateUser(db, {
        actorId: admin.id,
        userId: admin.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "You cannot deactivate your own account.",
    });

    await expect(
      deactivateUser(db, {
        actorId: admin.id,
        userId: invitedAdmin.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "At least one active administrator is required.",
    });

    await expect(
      deactivateUser(db, {
        actorId: admin.id,
        userId: MISSING_ID,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "User not found.",
    });

    await expect(
      deactivateUser(db, {
        actorId: member.id,
        userId: victim.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "You do not have permission to perform this action.",
    });

    await expect(
      deactivateUser(db, {
        actorId: MISSING_ID,
        userId: victim.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "UnauthenticatedError",
      message: "Authentication required.",
    });

    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("rejects ineligible reactivation with exact errors", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const active = await seedUser(db, { email: "active@example.com" });
    const invited = await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
    });
    const passwordless = await seedUser(db, {
      email: "passwordless@example.com",
      status: "deactivated",
      password: null,
    });
    const member = await seedUser(db, { email: "member@example.com" });

    for (const userId of [active.id, invited.id]) {
      await expect(
        reactivateUser(db, {
          actorId: admin.id,
          userId,
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "ConflictError",
        message: "This account is not deactivated.",
      });
    }

    await expect(
      reactivateUser(db, {
        actorId: admin.id,
        userId: passwordless.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "Send a new invitation instead.",
    });

    await expect(
      reactivateUser(db, {
        actorId: admin.id,
        userId: MISSING_ID,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "User not found.",
    });

    await expect(
      reactivateUser(db, {
        actorId: member.id,
        userId: passwordless.id,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("audits reactivation without restoring previous sessions or creating a new one", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const login = await loginWithPassword(db, {
      email: "member@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });

    await deactivateUser(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });
    await reactivateUser(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    expect(await getSessionUserByToken(db, login.session.token, NOW)).toBeNull();
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, member.id));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.revokedAt).not.toBeNull();

    const [memberRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, member.id));
    expect(memberRow?.accountStatus).toBe("active");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_reactivated"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(admin.id);
    expect(audits[0]?.actorEmail).toBe("admin@example.com");
    expect(audits[0]?.entityType).toBe("user");
    expect(audits[0]?.entityId).toBe(member.id);
    expect(audits[0]?.details).toEqual({ email: "member@example.com" });
  });

  it("lists users only for administrators with public fields in creation order", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const invited = await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
    });
    const deactivated = await seedUser(db, {
      email: "deactivated@example.com",
      status: "deactivated",
    });

    for (const [index, user] of [admin, member, invited, deactivated].entries()) {
      await db
        .update(users)
        .set({ createdAt: new Date(NOW.getTime() + index * 1000) })
        .where(eq(users.id, user.id));
    }

    const listed = await listUsers(db, admin.id);
    expect(listed.map((user) => user.id)).toEqual([
      admin.id,
      member.id,
      invited.id,
      deactivated.id,
    ]);
    expect(listed.map((user) => user.accountStatus)).toEqual([
      "active",
      "active",
      "invited",
      "deactivated",
    ]);

    for (const user of listed) {
      expect(Object.keys(user).sort()).toEqual(
        [
          "accountStatus",
          "email",
          "id",
          "lastLoginAt",
          "name",
          "role",
        ].sort(),
      );
      expect("passwordHash" in user).toBe(false);
    }

    await expect(listUsers(db, MISSING_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      listUsers(
        db,
        (
          await seedUser(db, {
            email: "list-invited-admin@example.com",
            role: "admin",
            status: "invited",
          })
        ).id,
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(listUsers(db, member.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
