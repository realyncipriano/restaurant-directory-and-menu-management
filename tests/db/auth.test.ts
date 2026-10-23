import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { authTokens, rateLimits, sessions, users } from "@/db/schema";
import type { EphemeralDb } from "./ephemeral-db";
import { getSessionUserByToken } from "@/lib/auth/session";
import { hashIdentifier } from "@/lib/auth/tokens";
import {
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import {
  activateAccount,
  changePassword,
  createInvite,
  createPasswordResetLink,
  deactivateUser,
  getActivationContext,
  listUsers,
  loginWithPassword,
  reactivateUser,
  resetPasswordWithToken,
} from "@/server/services/auth";
import {
  openTestDb,
  resetTestDb,
  seedUser,
  TEST_PASSWORD,
} from "../helpers/db";

const NEW_PASSWORD = "New-Password-456!";
const NOW = new Date("2026-01-15T12:00:00.000Z");
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("authentication services (ephemeral PGlite)", () => {
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

  it("logs in an active user and validates the session", async () => {
    const user = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const result = await loginWithPassword(db, {
      email: "ADMIN@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });

    expect(result.user.id).toBe(user.id);
    expect(result.session.token).toHaveLength(43);

    const sessionUser = await getSessionUserByToken(
      db,
      result.session.token,
      NOW,
    );
    expect(sessionUser?.email).toBe("admin@example.com");
    expect(sessionUser?.role).toBe("admin");
  });

  it("rejects wrong passwords and deactivated accounts without revealing which", async () => {
    await seedUser(db, { email: "user@example.com" });
    await seedUser(db, {
      email: "off@example.com",
      status: "deactivated",
    });

    await expect(
      loginWithPassword(db, {
        email: "user@example.com",
        password: "Wrong-Password-999!",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    await expect(
      loginWithPassword(db, {
        email: "off@example.com",
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rate limits repeated login attempts for the same email and IP", async () => {
    await seedUser(db, { email: "limit@example.com" });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        loginWithPassword(db, {
          email: "limit@example.com",
          password: "Wrong-Password-999!",
          ipHash: "ip-limit",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    await expect(
      loginWithPassword(db, {
        email: "limit@example.com",
        password: TEST_PASSWORD,
        ipHash: "ip-limit",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("creates a single-use invitation that activates the account and signs in", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "new.member@example.com",
      name: "New Member",
      now: NOW,
    });

    expect(invite.url).toContain("/activate?token=");
    const context = await getActivationContext(db, invite.token, NOW);
    expect(context?.kind).toBe("invite");
    expect(context?.email).toBe("new.member@example.com");

    const activated = await activateAccount(db, {
      token: invite.token,
      name: "New Member",
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      now: NOW,
    });
    expect(activated.user.accountStatus).toBe("active");

    const sessionUser = await getSessionUserByToken(
      db,
      activated.session.token,
      NOW,
    );
    expect(sessionUser?.email).toBe("new.member@example.com");

    await expect(
      activateAccount(db, {
        token: invite.token,
        name: "New Member",
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects expired invitations and permission checks on invites", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });

    await expect(
      createInvite(db, {
        actorId: member.id,
        email: "nope@example.com",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "late@example.com",
      now: NOW,
    });

    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    await expect(
      activateAccount(db, {
        token: invite.token,
        name: "Late",
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: later,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renews an outstanding invite instead of creating a duplicate", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const first = await createInvite(db, {
      actorId: admin.id,
      email: "dup@example.com",
      now: NOW,
    });
    const second = await createInvite(db, {
      actorId: admin.id,
      email: "dup@example.com",
      name: "Updated Name",
      now: NOW,
    });

    expect(second.user.id).toBe(first.user.id);
    expect(second.token).not.toBe(first.token);
    expect(await getActivationContext(db, first.token, NOW)).toBeNull();
    expect(await getActivationContext(db, second.token, NOW)).not.toBeNull();
  });

  it("re-invites a deactivated user who never set a password", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const first = await createInvite(db, {
      actorId: admin.id,
      email: "cancelled@example.com",
      now: NOW,
    });
    await deactivateUser(db, {
      actorId: admin.id,
      userId: first.user.id,
      now: NOW,
    });

    const renewed = await createInvite(db, {
      actorId: admin.id,
      email: "cancelled@example.com",
      name: "Returning Member",
      now: NOW,
    });

    expect(renewed.user.id).toBe(first.user.id);
    expect(renewed.user.accountStatus).toBe("invited");
    expect(renewed.user.name).toBe("Returning Member");
    expect(await getActivationContext(db, first.token, NOW)).toBeNull();
    expect(await getActivationContext(db, renewed.token, NOW)).not.toBeNull();
  });

  it("applies a global per-account login limit independent of IP", async () => {
    await seedUser(db, { email: "global@example.com" });
    const emailHash = hashIdentifier("global@example.com");
    const windowEndsAt = new Date(NOW.getTime() + 60 * 60 * 1000);

    await db.insert(rateLimits).values({
      key: `login-account-global:${emailHash}`,
      count: 50,
      windowEndsAt,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(
      loginWithPassword(db, {
        email: "global@example.com",
        password: TEST_PASSWORD,
        ipHash: "fresh-ip",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("clears only the scoped account login limit after a successful sign-in", async () => {
    await seedUser(db, { email: "reset-limit@example.com" });
    const emailHash = hashIdentifier("reset-limit@example.com");
    const accountKey = `login-account:${emailHash}:ip-reset`;

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await expect(
        loginWithPassword(db, {
          email: "reset-limit@example.com",
          password: "Wrong-Password-999!",
          ipHash: "ip-reset",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    await loginWithPassword(db, {
      email: "reset-limit@example.com",
      password: TEST_PASSWORD,
      ipHash: "ip-reset",
      now: NOW,
    });

    const rows = await db.select().from(rateLimits);
    const counts = new Map(rows.map((row) => [row.key, row.count]));
    expect(counts.has(accountKey)).toBe(false);
    expect(counts.get(`login-account-global:${emailHash}`)).toBe(10);
    expect(counts.get("login-ip:ip-reset")).toBe(10);
  });

  it("enforces the IP login limit independently of account limits", async () => {
    await db.insert(rateLimits).values({
      key: "login-ip:ip-only",
      count: 30,
      windowEndsAt: new Date(NOW.getTime() + 15 * 60 * 1000),
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(
      loginWithPassword(db, {
        email: "ip-only@example.com",
        password: TEST_PASSWORD,
        ipHash: "ip-only",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const rows = await db.select().from(rateLimits);
    const counts = new Map(rows.map((row) => [row.key, row.count]));
    const emailHash = hashIdentifier("ip-only@example.com");
    expect(counts.get(`login-account:${emailHash}:ip-only`)).toBe(1);
    expect(counts.get(`login-account-global:${emailHash}`)).toBe(1);
    expect(counts.get("login-ip:ip-only")).toBe(31);
  });

  it("returns the same generic failure for unknown, invited, and passwordless accounts", async () => {
    await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
    });
    await seedUser(db, {
      email: "passwordless@example.com",
      password: null,
    });

    const emails = [
      "unknown@example.com",
      "invited@example.com",
      "passwordless@example.com",
    ];

    for (const email of emails) {
      const failure = await loginWithPassword(db, {
        email,
        password: TEST_PASSWORD,
        now: NOW,
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(InvalidCredentialsError);
      if (failure instanceof InvalidCredentialsError) {
        expect(failure.code).toBe("invalid_credentials");
        expect(failure.message).toBe("Invalid email or password.");
      }
    }
  });

  it("invalidates outstanding reset tokens when a password changes", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const reset = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    await changePassword(db, {
      actorId: member.id,
      currentPassword: TEST_PASSWORD,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      now: NOW,
    });

    expect(await getActivationContext(db, reset.token, NOW)).toBeNull();
  });

  it("rejects reset links for missing, invited, deactivated, and passwordless accounts", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const invited = await seedUser(db, {
      email: "invited-reset@example.com",
      status: "invited",
    });
    const deactivated = await seedUser(db, {
      email: "deactivated-reset@example.com",
      status: "deactivated",
    });
    const passwordless = await seedUser(db, {
      email: "passwordless-reset@example.com",
      password: null,
    });

    await expect(
      createPasswordResetLink(db, {
        actorId: admin.id,
        userId: MISSING_ID,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    for (const userId of [invited.id, deactivated.id, passwordless.id]) {
      await expect(
        createPasswordResetLink(db, {
          actorId: admin.id,
          userId,
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    }

    const tokenRows = await db.select().from(authTokens);
    expect(tokenRows).toHaveLength(0);
  });

  it("rejects tokens used by the wrong credential flow without consuming them", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "wrong-purpose@example.com",
      now: NOW,
    });
    const reset = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    await expect(
      resetPasswordWithToken(db, {
        token: invite.token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      activateAccount(db, {
        token: reset.token,
        name: "Wrong Purpose",
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await getActivationContext(db, invite.token, NOW))?.kind).toBe(
      "invite",
    );
    expect((await getActivationContext(db, reset.token, NOW))?.kind).toBe(
      "password_reset",
    );
  });

  it("resets a password, revokes existing sessions, and issues a new session", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });

    const oldLogin = await loginWithPassword(db, {
      email: "member@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });

    const reset = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });
    const context = await getActivationContext(db, reset.token, NOW);
    expect(context?.kind).toBe("password_reset");

    const resetResult = await resetPasswordWithToken(db, {
      token: reset.token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      now: NOW,
    });

    expect(
      await getSessionUserByToken(db, oldLogin.session.token, NOW),
    ).toBeNull();
    expect(
      await getSessionUserByToken(db, resetResult.session.token, NOW),
    ).not.toBeNull();

    await expect(
      resetPasswordWithToken(db, {
        token: reset.token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      loginWithPassword(db, {
        email: "member@example.com",
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const newLogin = await loginWithPassword(db, {
      email: "member@example.com",
      password: NEW_PASSWORD,
      now: NOW,
    });
    expect(newLogin.user.id).toBe(member.id);
  });

  it("changes a password only with the current password and rotates sessions", async () => {
    const user = await seedUser(db, { email: "user@example.com" });
    const login = await loginWithPassword(db, {
      email: "user@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });

    await expect(
      changePassword(db, {
        actorId: user.id,
        currentPassword: "Wrong-Password-999!",
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const changed = await changePassword(db, {
      actorId: user.id,
      currentPassword: TEST_PASSWORD,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      now: NOW,
    });

    expect(await getSessionUserByToken(db, login.session.token, NOW)).toBeNull();
    expect(
      await getSessionUserByToken(db, changed.session.token, NOW),
    ).not.toBeNull();
  });

  it("revokes every existing session after a password change", async () => {
    const user = await seedUser(db, { email: "multi-session@example.com" });
    const first = await loginWithPassword(db, {
      email: "multi-session@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });
    const second = await loginWithPassword(db, {
      email: "multi-session@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });

    const changed = await changePassword(db, {
      actorId: user.id,
      currentPassword: TEST_PASSWORD,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      now: NOW,
    });

    expect(await getSessionUserByToken(db, first.session.token, NOW)).toBeNull();
    expect(
      await getSessionUserByToken(db, second.session.token, NOW),
    ).toBeNull();
    expect(
      await getSessionUserByToken(db, changed.session.token, NOW),
    ).not.toBeNull();

    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(sessionRows).toHaveLength(3);
    expect(sessionRows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it("deactivates and reactivates users, revoking access in between", async () => {
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

    expect(await getSessionUserByToken(db, login.session.token, NOW)).toBeNull();
    await expect(
      loginWithPassword(db, {
        email: "member@example.com",
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    await reactivateUser(db, {
      actorId: admin.id,
      userId: member.id,
      now: NOW,
    });

    const relogin = await loginWithPassword(db, {
      email: "member@example.com",
      password: TEST_PASSWORD,
      now: NOW,
    });
    expect(relogin.user.id).toBe(member.id);
  });

  it("invalidates reset tokens when the target account is deactivated", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, {
      email: "deactivate-reset@example.com",
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

    expect(await getActivationContext(db, reset.token, NOW)).toBeNull();
    await expect(
      resetPasswordWithToken(db, {
        token: reset.token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("prevents self-deactivation and non-admin user management", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });

    await expect(
      deactivateUser(db, {
        actorId: admin.id,
        userId: admin.id,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(listUsers(db, member.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const listed = await listUsers(db, admin.id);
    expect(listed).toHaveLength(2);
  });

  it("enforces strong passwords and single-use tokens at the database level", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "weak@example.com",
      now: NOW,
    });

    await expect(
      activateAccount(db, {
        token: invite.token,
        name: "Weak",
        password: "alllowercase",
        confirmPassword: "alllowercase",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const context = await getActivationContext(db, invite.token, NOW);
    expect(context).not.toBeNull();

    const tokenRow = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, invite.user.id));
    expect(tokenRow).toHaveLength(1);
    expect(tokenRow[0]?.usedAt).toBeNull();

    const activeSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, invite.user.id));
    expect(activeSessions).toHaveLength(0);

    const userRow = await db
      .select()
      .from(users)
      .where(eq(users.id, invite.user.id));
    expect(userRow[0]?.accountStatus).toBe("invited");
    expect(userRow[0]?.passwordHash).toBeNull();
  });
});
