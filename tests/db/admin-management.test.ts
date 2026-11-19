import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { auditLogs, authTokens, sessions, users } from "@/db/schema";
import { hashTokenWithSecret } from "@/lib/auth/token-crypto";
import { getSessionUserByToken } from "@/lib/auth/session";
import {
  ForbiddenError,
  InvalidCredentialsError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import {
  createPasswordResetLink,
  deactivateUser,
  getActivationContext,
  loginWithPassword,
  resetPasswordWithToken,
  setUserRole,
} from "@/server/services/auth";
import {
  ADMIN_RECOVERY_TTL_MS,
  createAdminRecoveryLink,
} from "@/server/services/auth/recovery";
import {
  openTestDb,
  resetTestDb,
  seedUser,
  TEST_PASSWORD,
} from "../helpers/db";
import type { EphemeralDb } from "./ephemeral-db";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const RECOVERY_SECRET = process.env.AUTH_SECRET ?? "";
const APP_URL = "https://menus.example.com";
const NEW_PASSWORD = "Recovered-Password-9!";

function tokenFromUrl(url: string): string {
  const token = new URL(url).searchParams.get("token");
  if (!token) {
    throw new Error("Recovery URL did not contain a token.");
  }
  return token;
}

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

describe("administrator role management (ephemeral PGlite)", () => {
  it("promotes an active authorized user transactionally and audits the change", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });

    const result = await setUserRole(db, {
      actorId: admin.id,
      userId: member.id,
      role: "admin",
      now: NOW,
    });

    expect(result.changed).toBe(true);
    expect(result.user.role).toBe("admin");
    expect(result.user.id).toBe(member.id);

    const [memberRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, member.id));
    expect(memberRow?.role).toBe("admin");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_role_changed"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(admin.id);
    expect(audits[0]?.actorEmail).toBe("admin@example.com");
    expect(audits[0]?.entityType).toBe("user");
    expect(audits[0]?.entityId).toBe(member.id);
    expect(audits[0]?.details).toEqual({
      email: "member@example.com",
      previousRole: "authorized_user",
      newRole: "admin",
    });
  });

  it("demotes an administrator when another active administrator remains", async () => {
    const first = await seedUser(db, {
      email: "first-admin@example.com",
      role: "admin",
    });
    const second = await seedUser(db, {
      email: "second-admin@example.com",
      role: "admin",
    });

    const result = await setUserRole(db, {
      actorId: first.id,
      userId: second.id,
      role: "authorized_user",
      now: NOW,
    });

    expect(result.changed).toBe(true);
    expect(result.user.role).toBe("authorized_user");

    const [secondRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, second.id));
    expect(secondRow?.role).toBe("authorized_user");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_role_changed"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(first.id);
    expect(audits[0]?.details).toEqual({
      email: "second-admin@example.com",
      previousRole: "admin",
      newRole: "authorized_user",
    });
  });

  it("rejects self-role changes, including sole-administrator self-demotion", async () => {
    const soleAdmin = await seedUser(db, {
      email: "sole-admin@example.com",
      role: "admin",
    });

    await expect(
      setUserRole(db, {
        actorId: soleAdmin.id,
        userId: soleAdmin.id,
        role: "authorized_user",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "You cannot change your own role.",
      reason: "self",
    });

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, soleAdmin.id));
    expect(row?.role).toBe("admin");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it.each([
    ["canonical", (value: string) => value],
    ["uppercase", (value: string) => value.toUpperCase()],
    ["unhyphenated", (value: string) => value.replaceAll("-", "")],
    ["braced", (value: string) => `{${value}}`],
  ])(
    "resolves a %s target UUID before comparing identities",
    async (_label, toInput) => {
      const admin = await seedUser(db, {
        email: "admin@example.com",
        role: "admin",
      });
      const target = await seedUser(db, { email: "target@example.com" });

      const result = await setUserRole(db, {
        actorId: admin.id,
        userId: toInput(target.id),
        role: "admin",
        now: NOW,
      });

      expect(result.changed).toBe(true);
      expect(result.user.id).toBe(target.id);
      expect(result.user.role).toBe("admin");
    },
  );

  it("blocks self-targeting through equivalent UUID forms in both actions", async () => {
    const soleAdmin = await seedUser(db, {
      email: "sole-admin@example.com",
      role: "admin",
    });

    const equivalentForms = [
      soleAdmin.id.toUpperCase(),
      soleAdmin.id.replaceAll("-", ""),
      `{${soleAdmin.id}}`,
      `urn:uuid:${soleAdmin.id}`,
    ];

    for (const userId of equivalentForms) {
      await expect(
        setUserRole(db, {
          actorId: soleAdmin.id,
          userId,
          role: "authorized_user",
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "ConflictError",
        message: "You cannot change your own role.",
        reason: "self",
      });

      await expect(
        deactivateUser(db, {
          actorId: soleAdmin.id,
          userId,
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "ConflictError",
        message: "You cannot deactivate your own account.",
        reason: "self",
      });
    }

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, soleAdmin.id));
    expect(row?.role).toBe("admin");
    expect(row?.accountStatus).toBe("active");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("rejects non-administrator actors and inactive actors", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    const target = await seedUser(db, { email: "target@example.com" });
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

    await expect(
      setUserRole(db, {
        actorId: member.id,
        userId: target.id,
        role: "admin",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    for (const actorId of [MISSING_ID, invitedAdmin.id, deactivatedAdmin.id]) {
      await expect(
        setUserRole(db, {
          actorId,
          userId: target.id,
          role: "admin",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    }

    const [targetRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, target.id));
    expect(targetRow?.role).toBe("authorized_user");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    expect(admin.id).toBeDefined();
  });

  it("rejects invited, deactivated, passwordless, and missing targets", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const invited = await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
    });
    const deactivated = await seedUser(db, {
      email: "deactivated@example.com",
      status: "deactivated",
    });
    const passwordless = await seedUser(db, {
      email: "passwordless@example.com",
      password: null,
    });

    for (const userId of [invited.id, deactivated.id]) {
      await expect(
        setUserRole(db, {
          actorId: admin.id,
          userId,
          role: "admin",
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "ConflictError",
        message: "Activate or reactivate the account first.",
        reason: "inactive",
      });
    }

    await expect(
      setUserRole(db, {
        actorId: admin.id,
        userId: passwordless.id,
        role: "admin",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ConflictError",
      message: "This account cannot be changed until it has a password.",
      reason: "passwordless",
    });

    await expect(
      setUserRole(db, {
        actorId: admin.id,
        userId: MISSING_ID,
        role: "admin",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "User not found.",
    });

    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("rejects an unknown role value before changing anything", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });

    await expect(
      setUserRole(db, {
        actorId: admin.id,
        userId: member.id,
        role: "superadmin",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, member.id));
    expect(row?.role).toBe("authorized_user");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("treats a repeated same-role request as an idempotent no-op", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });

    await setUserRole(db, {
      actorId: admin.id,
      userId: member.id,
      role: "admin",
      now: NOW,
    });
    const repeated = await setUserRole(db, {
      actorId: admin.id,
      userId: member.id,
      role: "admin",
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(repeated.changed).toBe(false);
    expect(repeated.user.role).toBe("admin");
    expect(repeated.user.id).toBe(member.id);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_role_changed"));
    expect(audits).toHaveLength(1);
  });

  it("applies role changes to existing sessions without revocation", async () => {
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

    await setUserRole(db, {
      actorId: admin.id,
      userId: member.id,
      role: "admin",
      now: NOW,
    });

    expect(
      (await getSessionUserByToken(db, login.session.token, NOW))?.role,
    ).toBe("admin");

    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, member.id));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.revokedAt).toBeNull();
  });
});

describe("administrator recovery (ephemeral PGlite)", () => {
  it("issues a hashed one-hour link for an active administrator without exposing the token", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    const link = await createAdminRecoveryLink(db, {
      email: "ADMIN@example.com",
      appUrl: APP_URL,
      authSecret: RECOVERY_SECRET,
      now: NOW,
    });
    const token = tokenFromUrl(link.url);

    expect(link.url.startsWith(`${APP_URL}/activate?token=`)).toBe(true);
    expect(link.expiresAt.getTime()).toBe(
      NOW.getTime() + ADMIN_RECOVERY_TTL_MS,
    );
    expect(link.user).toEqual({ id: admin.id, email: "admin@example.com" });

    const tokenRows = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, admin.id));
    expect(tokenRows).toHaveLength(1);
    const tokenRow = tokenRows[0]!;
    expect(tokenRow.purpose).toBe("password_reset");
    expect(tokenRow.tokenHash).toBe(
      hashTokenWithSecret(RECOVERY_SECRET, token),
    );
    expect(tokenRow.tokenHash).not.toBe(token);
    expect(tokenRow.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenRow.expiresAt.getTime()).toBe(
      NOW.getTime() + ADMIN_RECOVERY_TTL_MS,
    );
    expect(tokenRow.createdAt.getTime()).toBe(NOW.getTime());
    expect(tokenRow.usedAt).toBeNull();
    expect(tokenRow.createdBy).toBeNull();

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "admin_recovery_link_created"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: null,
      actorEmail: null,
      entityType: "user",
      entityId: admin.id,
      details: { email: "admin@example.com", source: "cli" },
    });
    expect(JSON.stringify(audits[0])).not.toContain(token);
    expect(JSON.stringify(audits[0])).not.toContain(tokenRow.tokenHash);

    expect((await getActivationContext(db, token, NOW))?.kind).toBe(
      "password_reset",
    );

    const [adminRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, admin.id));
    expect(adminRow?.role).toBe("admin");
    expect(adminRow?.accountStatus).toBe("active");
  });

  it("refuses non-admins, inactive admins, passwordless admins, and unknown emails", async () => {
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
    const passwordlessAdmin = await seedUser(db, {
      email: "passwordless-admin@example.com",
      role: "admin",
      password: null,
    });

    for (const email of [
      member.email,
      invitedAdmin.email,
      deactivatedAdmin.email,
      passwordlessAdmin.email,
    ]) {
      await expect(
        createAdminRecoveryLink(db, {
          email,
          appUrl: APP_URL,
          authSecret: RECOVERY_SECRET,
          now: NOW,
        }),
      ).rejects.toMatchObject({
        name: "ConflictError",
        message:
          "Recovery requires an existing active administrator account with a password.",
      });
    }

    await expect(
      createAdminRecoveryLink(db, {
        email: "missing@example.com",
        appUrl: APP_URL,
        authSecret: RECOVERY_SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "No account exists with that email.",
    });

    const rows = await db.select().from(users);
    expect(rows.find((row) => row.id === member.id)?.role).toBe(
      "authorized_user",
    );
    expect(rows.find((row) => row.id === invitedAdmin.id)?.accountStatus).toBe(
      "invited",
    );
    expect(
      rows.find((row) => row.id === deactivatedAdmin.id)?.accountStatus,
    ).toBe("deactivated");
    expect(await db.select().from(authTokens)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("invalidates earlier unused reset links without touching other tokens", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const first = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: admin.id,
      now: NOW,
    });

    const link = await createAdminRecoveryLink(db, {
      email: admin.email,
      appUrl: APP_URL,
      authSecret: RECOVERY_SECRET,
      now: NOW,
    });
    const token = tokenFromUrl(link.url);

    expect(await getActivationContext(db, first.token, NOW)).toBeNull();
    expect((await getActivationContext(db, token, NOW))?.kind).toBe(
      "password_reset",
    );

    const rows = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, admin.id));
    expect(rows).toHaveLength(2);
    const firstRow = rows.find(
      (row) => row.tokenHash !== hashTokenWithSecret(RECOVERY_SECRET, token),
    );
    expect(firstRow?.usedAt?.getTime()).toBe(NOW.getTime());
    expect(
      rows.find(
        (row) => row.tokenHash === hashTokenWithSecret(RECOVERY_SECRET, token),
      )?.usedAt,
    ).toBeNull();
  });

  it("resets the password once, revokes existing sessions, and preserves administrator access", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const oldLogin = await loginWithPassword(db, {
      email: admin.email,
      password: TEST_PASSWORD,
      now: NOW,
    });

    const link = await createAdminRecoveryLink(db, {
      email: admin.email,
      appUrl: APP_URL,
      authSecret: RECOVERY_SECRET,
      now: NOW,
    });
    const token = tokenFromUrl(link.url);

    const reset = await resetPasswordWithToken(db, {
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      now: NOW,
    });

    expect(reset.user.id).toBe(admin.id);
    expect(reset.user.role).toBe("admin");
    expect(reset.user.accountStatus).toBe("active");
    expect(
      await getSessionUserByToken(db, oldLogin.session.token, NOW),
    ).toBeNull();
    expect(
      await getSessionUserByToken(db, reset.session.token, NOW),
    ).not.toBeNull();

    await expect(
      resetPasswordWithToken(db, {
        token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "This password reset link is invalid or has expired.",
    });

    await expect(
      loginWithPassword(db, {
        email: admin.email,
        password: TEST_PASSWORD,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const newLogin = await loginWithPassword(db, {
      email: admin.email,
      password: NEW_PASSWORD,
      now: NOW,
    });
    expect(newLogin.user.id).toBe(admin.id);
    expect(newLogin.user.role).toBe("admin");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "admin_recovery_link_created"));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain(token);
  });

  it("enforces production-safe recovery URLs with an explicit development opt-in", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    for (const appUrl of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://127.0.0.1",
      "https://10.0.0.1",
      "https://[::1]",
      "https://localhost.",
    ]) {
      await expect(
        createAdminRecoveryLink(db, {
          email: admin.email,
          appUrl,
          authSecret: RECOVERY_SECRET,
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }

    const developmentLink = await createAdminRecoveryLink(db, {
      email: admin.email,
      appUrl: "http://localhost:3000/some/path",
      authSecret: RECOVERY_SECRET,
      allowDevelopmentUrl: true,
      now: NOW,
    });
    expect(
      developmentLink.url.startsWith("http://localhost:3000/activate?token="),
    ).toBe(true);

    const trailingDotLink = await createAdminRecoveryLink(db, {
      email: admin.email,
      appUrl: "https://menus.example.com./some/path",
      authSecret: RECOVERY_SECRET,
      now: NOW,
    });
    expect(
      trailingDotLink.url.startsWith(
        "https://menus.example.com/activate?token=",
      ),
    ).toBe(true);
  });

  it("rejects an invalid secret or app URL before writing a token", async () => {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });

    await expect(
      createAdminRecoveryLink(db, {
        email: admin.email,
        appUrl: APP_URL,
        authSecret: "too-short",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      createAdminRecoveryLink(db, {
        email: admin.email,
        appUrl: "not-a-url",
        authSecret: RECOVERY_SECRET,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await db.select().from(authTokens)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });
});
