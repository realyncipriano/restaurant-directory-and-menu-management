import { Pool } from "@neondatabase/serverless";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { assertSafeTestTarget } from "@/db/safety";
import {
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
} from "@/lib/errors";
import {
  auditLogs,
  authTokens,
  menuCategories,
  menuImportItems,
  menuImports,
  menuItems,
  menus,
  users,
} from "@/db/schema";
import {
  createInvite,
  createPasswordResetLink,
  deactivateUser,
  reactivateUser,
  setUserRole,
} from "@/server/services/auth";
import { issueToken } from "@/server/services/auth/token-store";
import {
  acceptAllImportItems,
  applyMenuImport,
  keepOnlyImportCategory,
  updateImportCategoryDecision,
  updateImportItem,
} from "@/server/services/imports";
import {
  createCategory,
  createMenuItem,
} from "@/server/services/menu-content";
import { createMenu, publishMenu } from "@/server/services/menus";
import { createRestaurant } from "@/server/services/restaurants";
import { seedUser } from "../helpers/db";

const integrationTarget = assertSafeTestTarget(process.env);

async function waitForAdvisoryLockWaiters(
  pool: Pool,
  expected: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ total: string }>(
      "select count(*)::text as total from pg_locks where locktype = 'advisory' and not granted",
    );
    if (Number(result.rows[0]?.total ?? 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${expected} advisory lock waiter(s).`,
  );
}

async function waitForUngrantedLockWaiters(
  pool: Pool,
  expected: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ total: string }>(
      "select count(distinct pid)::text as total from pg_locks where not granted",
    );
    if (Number(result.rows[0]?.total ?? 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${expected} blocked lock waiter(s).`,
  );
}

describe("database concurrency (dedicated test database)", () => {
  let pool: Pool;
  let db: DbClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: integrationTarget.connectionString });
    db = drizzle(pool) as unknown as DbClient;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE
        audit_logs,
        menu_change_logs,
        menu_import_items,
        menu_import_pages,
        menu_imports,
        menu_item_modifiers,
        menu_item_variants,
        menu_items,
        menu_categories,
        menus,
        restaurant_user_permissions,
        restaurants,
        auth_tokens,
        sessions,
        rate_limits,
        app_settings,
        users
      RESTART IDENTITY CASCADE
    `);
  });

  async function activeTokensFor(
    userId: string,
    purpose: "invite" | "password_reset",
  ) {
    return db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
        ),
      );
  }

  it("never leaves zero active administrators", async () => {
    const first = await seedUser(db, {
      email: "first-admin@example.com",
      role: "admin",
    });
    const second = await seedUser(db, {
      email: "second-admin@example.com",
      role: "admin",
    });

    const results = await Promise.allSettled([
      deactivateUser(db, {
        actorId: first.id,
        userId: second.id,
      }),
      deactivateUser(db, {
        actorId: second.id,
        userId: first.id,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const [active] = await db
      .select({ total: count() })
      .from(users)
      .where(eq(users.accountStatus, "active"));
    expect(active?.total).toBe(1);
  });

  it("serializes concurrent demotion and deactivation of the last two admins", async () => {
    const first = await seedUser(db, {
      email: "demote-deactivate-first@example.com",
      role: "admin",
    });
    const second = await seedUser(db, {
      email: "demote-deactivate-second@example.com",
      role: "admin",
    });

    const results = await Promise.allSettled([
      setUserRole(db, {
        actorId: first.id,
        userId: second.id,
        role: "authorized_user",
      }),
      deactivateUser(db, {
        actorId: second.id,
        userId: first.id,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [activeAdmins] = await db
      .select({ total: count() })
      .from(users)
      .where(
        and(eq(users.role, "admin"), eq(users.accountStatus, "active")),
      );
    expect(activeAdmins?.total).toBe(1);
  });

  it("serializes mutual concurrent demotions of the last two administrators", async () => {
    const first = await seedUser(db, {
      email: "mutual-demote-first@example.com",
      role: "admin",
    });
    const second = await seedUser(db, {
      email: "mutual-demote-second@example.com",
      role: "admin",
    });

    const results = await Promise.allSettled([
      setUserRole(db, {
        actorId: first.id,
        userId: second.id,
        role: "authorized_user",
      }),
      setUserRole(db, {
        actorId: second.id,
        userId: first.id,
        role: "authorized_user",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [activeAdmins] = await db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
    expect(activeAdmins?.total).toBe(1);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_role_changed"));
    expect(audits).toHaveLength(1);
  });

  it("serializes concurrent role changes affecting different administrators", async () => {
    const actor = await seedUser(db, {
      email: "role-actor@example.com",
      role: "admin",
    });
    const first = await seedUser(db, {
      email: "role-first@example.com",
      role: "admin",
    });
    const second = await seedUser(db, {
      email: "role-second@example.com",
      role: "admin",
    });

    const results = await Promise.allSettled([
      setUserRole(db, {
        actorId: actor.id,
        userId: first.id,
        role: "authorized_user",
      }),
      setUserRole(db, {
        actorId: actor.id,
        userId: second.id,
        role: "authorized_user",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    const [activeAdmins] = await db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
    expect(activeAdmins?.total).toBe(1);
    const [actorRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.id));
    expect(actorRow?.role).toBe("admin");
    expect(actorRow?.accountStatus).toBe("active");
  });

  it("serializes concurrent same-target role changes without duplicate audits", async () => {
    const actor = await seedUser(db, {
      email: "same-target-actor@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "same-target-admin@example.com",
      role: "admin",
    });

    const results = await Promise.allSettled([
      setUserRole(db, {
        actorId: actor.id,
        userId: target.id,
        role: "authorized_user",
      }),
      setUserRole(db, {
        actorId: actor.id,
        userId: target.id,
        role: "authorized_user",
      }),
    ]);

    const changed = results.filter(
      (result) => result.status === "fulfilled" && result.value.changed,
    );
    expect(changed).toHaveLength(1);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "user_role_changed"));
    expect(audits).toHaveLength(1);
    const [activeAdmins] = await db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
    expect(activeAdmins?.total).toBe(1);
  });

  it("rejects concurrent self-target attempts across equivalent UUID forms", async () => {
    const actor = await seedUser(db, {
      email: "self-target-concurrent-actor@example.com",
      role: "admin",
    });
    const otherAdmin = await seedUser(db, {
      email: "self-target-concurrent-other@example.com",
      role: "admin",
    });

    const forms = [
      actor.id,
      actor.id.toUpperCase(),
      actor.id.replaceAll("-", ""),
    ];
    const attempts = forms.flatMap((userId) => [
      {
        message: "You cannot change your own role.",
        promise: setUserRole(db, {
          actorId: actor.id,
          userId,
          role: "authorized_user",
        }),
      },
      {
        message: "You cannot deactivate your own account.",
        promise: deactivateUser(db, {
          actorId: actor.id,
          userId,
        }),
      },
    ]);

    const results = await Promise.allSettled(
      attempts.map((attempt) => attempt.promise),
    );
    results.forEach((result, index) => {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ConflictError);
        expect(result.reason).toMatchObject({
          message: attempts[index]?.message,
          reason: "self",
        });
      }
    });

    const [actorRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.id));
    const [otherRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, otherAdmin.id));
    expect(actorRow?.role).toBe("admin");
    expect(actorRow?.accountStatus).toBe("active");
    expect(otherRow?.role).toBe("admin");
    expect(otherRow?.accountStatus).toBe("active");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("rechecks actor authorization after acquiring the shared lock", async () => {
    const demotingAdmin = await seedUser(db, {
      email: "recheck-demoting-admin@example.com",
      role: "admin",
    });
    const staleActor = await seedUser(db, {
      email: "recheck-stale-admin@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "recheck-target@example.com",
      role: "authorized_user",
    });

    // Must match ADMIN_MEMBERSHIP_LOCK_KEY in src/server/services/auth/admin-membership.ts.
    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      // Queue the authorized demotion first, then the stale request. Both pass
      // their initial actor check while the test transaction holds the lock.
      const demotion = setUserRole(db, {
        actorId: demotingAdmin.id,
        userId: staleActor.id,
        role: "authorized_user",
      });
      pending.push(demotion);
      await waitForAdvisoryLockWaiters(pool, 1);

      const staleRequest = setUserRole(db, {
        actorId: staleActor.id,
        userId: target.id,
        role: "admin",
      });
      pending.push(staleRequest);
      await waitForAdvisoryLockWaiters(pool, 2);

      // Releasing the lock lets the queued demotion run first. The stale
      // request must then observe the demoted actor during its recheck.
      await lockClient.query("commit");

      const [demotionResult, staleResult] = await Promise.allSettled([
        demotion,
        staleRequest,
      ]);
      expect(demotionResult.status).toBe("fulfilled");
      if (demotionResult.status === "fulfilled") {
        expect(demotionResult.value.changed).toBe(true);
        expect(demotionResult.value.user.id).toBe(staleActor.id);
        expect(demotionResult.value.user.role).toBe("authorized_user");
      }
      expect(staleResult.status).toBe("rejected");
      if (staleResult.status === "rejected") {
        expect(staleResult.reason).toBeInstanceOf(ForbiddenError);
      }

      const [staleActorRow] = await db
        .select()
        .from(users)
        .where(eq(users.id, staleActor.id));
      expect(staleActorRow?.role).toBe("authorized_user");
      expect(staleActorRow?.accountStatus).toBe("active");

      const [targetRow] = await db
        .select()
        .from(users)
        .where(eq(users.id, target.id));
      expect(targetRow?.role).toBe("authorized_user");
      expect(targetRow?.accountStatus).toBe("active");

      const audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "user_role_changed"));
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actorId).toBe(demotingAdmin.id);
      expect(audits[0]?.entityId).toBe(staleActor.id);
      expect(audits[0]?.details).toMatchObject({
        previousRole: "admin",
        newRole: "authorized_user",
      });
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("rechecks actor authorization inside both invitation transactions", async () => {
    const staleActor = await seedUser(db, {
      email: "invite-stale-admin@example.com",
      role: "admin",
    });
    const existingInvite = await seedUser(db, {
      email: "existing-invite@example.com",
      status: "invited",
    });

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      // Both invitation paths pass their initial actor check while the test
      // transaction holds the shared lock.
      const renewal = createInvite(db, {
        actorId: staleActor.id,
        email: existingInvite.email,
      });
      pending.push(renewal);
      await waitForAdvisoryLockWaiters(pool, 1);

      const creation = createInvite(db, {
        actorId: staleActor.id,
        email: "new-invite@example.com",
      });
      pending.push(creation);
      await waitForAdvisoryLockWaiters(pool, 2);

      // Simulate a demotion committing while both invitations wait. The
      // in-transaction recheck must reject both instead of issuing tokens.
      await lockClient.query(
        "update users set role = 'authorized_user' where id = $1",
        [staleActor.id],
      );
      await lockClient.query("commit");

      const [renewalResult, creationResult] = await Promise.allSettled([
        renewal,
        creation,
      ]);
      expect(renewalResult.status).toBe("rejected");
      if (renewalResult.status === "rejected") {
        expect(renewalResult.reason).toBeInstanceOf(ForbiddenError);
      }
      expect(creationResult.status).toBe("rejected");
      if (creationResult.status === "rejected") {
        expect(creationResult.reason).toBeInstanceOf(ForbiddenError);
      }

      const [staleRow] = await db
        .select()
        .from(users)
        .where(eq(users.id, staleActor.id));
      expect(staleRow?.role).toBe("authorized_user");

      const [existingRow] = await db
        .select()
        .from(users)
        .where(eq(users.id, existingInvite.id));
      expect(existingRow?.accountStatus).toBe("invited");

      const created = await db
        .select()
        .from(users)
        .where(eq(users.email, "new-invite@example.com"));
      expect(created).toHaveLength(0);

      expect(await db.select().from(authTokens)).toHaveLength(0);
      expect(
        await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, "user_invited")),
      ).toHaveLength(0);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("leaves exactly one active reset token after concurrent issuance", async () => {
    const admin = await seedUser(db, {
      email: "reset-issuer@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "reset-target@example.com",
    });

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      const first = createPasswordResetLink(db, {
        actorId: admin.id,
        userId: target.id,
      });
      pending.push(first);
      await waitForAdvisoryLockWaiters(pool, 1);

      const second = createPasswordResetLink(db, {
        actorId: admin.id,
        userId: target.id,
      });
      pending.push(second);
      await waitForAdvisoryLockWaiters(pool, 2);

      await lockClient.query("commit");

      const results = await Promise.allSettled([first, second]);
      expect(
        results.every((result) => result.status === "fulfilled"),
      ).toBe(true);

      const active = await activeTokensFor(target.id, "password_reset");
      expect(active).toHaveLength(1);

      const all = await db
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.userId, target.id),
            eq(authTokens.purpose, "password_reset"),
          ),
        );
      expect(all).toHaveLength(2);

      const audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "password_reset_link_created"));
      expect(audits).toHaveLength(2);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("rejects reset issuance when the actor is demoted while waiting", async () => {
    const demotingAdmin = await seedUser(db, {
      email: "reset-demoting-admin@example.com",
      role: "admin",
    });
    const staleActor = await seedUser(db, {
      email: "reset-stale-admin@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "reset-demotion-target@example.com",
    });

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      const demotion = setUserRole(db, {
        actorId: demotingAdmin.id,
        userId: staleActor.id,
        role: "authorized_user",
      });
      pending.push(demotion);
      await waitForAdvisoryLockWaiters(pool, 1);

      const reset = createPasswordResetLink(db, {
        actorId: staleActor.id,
        userId: target.id,
      });
      pending.push(reset);
      await waitForAdvisoryLockWaiters(pool, 2);

      await lockClient.query("commit");

      const [demotionResult, resetResult] = await Promise.allSettled([
        demotion,
        reset,
      ]);
      expect(demotionResult.status).toBe("fulfilled");
      if (demotionResult.status === "fulfilled") {
        expect(demotionResult.value.changed).toBe(true);
      }
      expect(resetResult.status).toBe("rejected");
      if (resetResult.status === "rejected") {
        expect(resetResult.reason).toBeInstanceOf(ForbiddenError);
      }

      expect(await activeTokensFor(target.id, "password_reset")).toHaveLength(
        0,
      );
      const audits = await db.select().from(auditLogs);
      expect(
        audits.filter((audit) => audit.action === "user_role_changed"),
      ).toHaveLength(1);
      expect(
        audits.filter(
          (audit) => audit.action === "password_reset_link_created",
        ),
      ).toHaveLength(0);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("rejects reset issuance when the actor is deactivated while waiting", async () => {
    const deactivatingAdmin = await seedUser(db, {
      email: "reset-deactivating-admin@example.com",
      role: "admin",
    });
    const staleActor = await seedUser(db, {
      email: "reset-stale-deactivated-admin@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "reset-deactivation-target@example.com",
    });

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      const deactivation = deactivateUser(db, {
        actorId: deactivatingAdmin.id,
        userId: staleActor.id,
      });
      pending.push(deactivation);
      await waitForAdvisoryLockWaiters(pool, 1);

      const reset = createPasswordResetLink(db, {
        actorId: staleActor.id,
        userId: target.id,
      });
      pending.push(reset);
      await waitForAdvisoryLockWaiters(pool, 2);

      await lockClient.query("commit");

      const [deactivationResult, resetResult] = await Promise.allSettled([
        deactivation,
        reset,
      ]);
      expect(deactivationResult.status).toBe("fulfilled");
      if (deactivationResult.status === "fulfilled") {
        expect(deactivationResult.value.changed).toBe(true);
      }
      expect(resetResult.status).toBe("rejected");
      if (resetResult.status === "rejected") {
        expect(resetResult.reason).toBeInstanceOf(UnauthenticatedError);
      }

      expect(await activeTokensFor(target.id, "password_reset")).toHaveLength(
        0,
      );
      const audits = await db.select().from(auditLogs);
      expect(
        audits.filter((audit) => audit.action === "user_deactivated"),
      ).toHaveLength(1);
      expect(
        audits.filter(
          (audit) => audit.action === "password_reset_link_created",
        ),
      ).toHaveLength(0);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("invalidates a reset token issued immediately before target deactivation", async () => {
    const admin = await seedUser(db, {
      email: "reset-before-deactivation-admin@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "reset-before-deactivation-target@example.com",
    });

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      const reset = createPasswordResetLink(db, {
        actorId: admin.id,
        userId: target.id,
      });
      pending.push(reset);
      await waitForAdvisoryLockWaiters(pool, 1);

      const deactivation = deactivateUser(db, {
        actorId: admin.id,
        userId: target.id,
      });
      pending.push(deactivation);
      await waitForAdvisoryLockWaiters(pool, 2);

      await lockClient.query("commit");

      const [resetResult, deactivationResult] = await Promise.allSettled([
        reset,
        deactivation,
      ]);
      expect(resetResult.status).toBe("fulfilled");
      expect(deactivationResult.status).toBe("fulfilled");
      if (deactivationResult.status === "fulfilled") {
        expect(deactivationResult.value.changed).toBe(true);
      }

      expect(await activeTokensFor(target.id, "password_reset")).toHaveLength(
        0,
      );
      const tokenRows = await db
        .select()
        .from(authTokens)
        .where(eq(authTokens.userId, target.id));
      expect(tokenRows).toHaveLength(1);
      expect(tokenRows[0]?.usedAt).not.toBeNull();

      const audits = await db.select().from(auditLogs);
      expect(
        audits.filter(
          (audit) => audit.action === "password_reset_link_created",
        ),
      ).toHaveLength(1);
      expect(
        audits.filter((audit) => audit.action === "user_deactivated"),
      ).toHaveLength(1);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("rejects reset issuance when target deactivation wins the lock", async () => {
    const admin = await seedUser(db, {
      email: "deactivation-wins-admin@example.com",
      role: "admin",
    });
    const target = await seedUser(db, {
      email: "deactivation-wins-target@example.com",
    });

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query("select pg_advisory_xact_lock(hashtext($1))", [
        "rdmm.admin-membership",
      ]);

      const deactivation = deactivateUser(db, {
        actorId: admin.id,
        userId: target.id,
      });
      pending.push(deactivation);
      await waitForAdvisoryLockWaiters(pool, 1);

      const reset = createPasswordResetLink(db, {
        actorId: admin.id,
        userId: target.id,
      });
      pending.push(reset);
      await waitForAdvisoryLockWaiters(pool, 2);

      await lockClient.query("commit");

      const [deactivationResult, resetResult] = await Promise.allSettled([
        deactivation,
        reset,
      ]);
      expect(deactivationResult.status).toBe("fulfilled");
      if (deactivationResult.status === "fulfilled") {
        expect(deactivationResult.value.changed).toBe(true);
      }
      expect(resetResult.status).toBe("rejected");
      if (resetResult.status === "rejected") {
        expect(resetResult.reason).toBeInstanceOf(ConflictError);
      }

      expect(await activeTokensFor(target.id, "password_reset")).toHaveLength(
        0,
      );
      const audits = await db.select().from(auditLogs);
      expect(
        audits.filter((audit) => audit.action === "user_deactivated"),
      ).toHaveLength(1);
      expect(
        audits.filter(
          (audit) => audit.action === "password_reset_link_created",
        ),
      ).toHaveLength(0);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("does not revive reset tokens across deactivation and reactivation", async () => {
    const admin = await seedUser(db, {
      email: "reactivation-token-admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, {
      email: "reactivation-token-member@example.com",
    });

    const first = await createPasswordResetLink(db, {
      actorId: admin.id,
      userId: member.id,
    });
    expect(first.token).toBeTruthy();

    const deactivated = await deactivateUser(db, {
      actorId: admin.id,
      userId: member.id,
    });
    expect(deactivated.changed).toBe(true);

    const now = new Date();
    await issueToken(db, {
      userId: member.id,
      purpose: "password_reset",
      createdBy: admin.id,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      now,
    });
    expect(await activeTokensFor(member.id, "password_reset")).toHaveLength(1);

    await reactivateUser(db, {
      actorId: admin.id,
      userId: member.id,
    });

    expect(await activeTokensFor(member.id, "password_reset")).toHaveLength(0);
    const rows = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, member.id),
          eq(authTokens.purpose, "password_reset"),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.usedAt !== null)).toBe(true);
  }, 20_000);

  // The pre-fix autocommit renewal flow left two active invite tokens under
  // this overlap; the transaction and user-row lock now serialize renewals.
  it("serializes concurrent invitation renewals to one active token", async () => {
    const admin = await seedUser(db, {
      email: "invite-renewal-admin@example.com",
      role: "admin",
    });
    const invite = await createInvite(db, {
      actorId: admin.id,
      email: "invite-renewal-target@example.com",
    });
    const [tokenRow] = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, invite.user.id));

    const lockPool = new Pool({
      connectionString: integrationTarget.connectionString,
      max: 1,
    });
    const lockClient = await lockPool.connect();
    const pending: Promise<unknown>[] = [];
    try {
      await lockClient.query("begin");
      await lockClient.query(
        "select id from auth_tokens where id = $1 for update",
        [tokenRow!.id],
      );

      const first = createInvite(db, {
        actorId: admin.id,
        email: "invite-renewal-target@example.com",
      });
      pending.push(first);
      await waitForUngrantedLockWaiters(pool, 1);

      const second = createInvite(db, {
        actorId: admin.id,
        email: "invite-renewal-target@example.com",
      });
      pending.push(second);
      await waitForUngrantedLockWaiters(pool, 2);

      await lockClient.query("commit");

      const results = await Promise.allSettled([first, second]);
      expect(
        results.every((result) => result.status === "fulfilled"),
      ).toBe(true);

      const active = await activeTokensFor(invite.user.id, "invite");
      expect(active).toHaveLength(1);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      await Promise.allSettled(pending);
      await lockPool.end();
    }
  }, 20_000);

  it("serializes concurrent publishes of the same draft", async () => {
    const admin = await seedUser(db, {
      email: "publisher@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Concurrent Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Dinner",
    });
    const category = await createCategory(db, admin.id, menu.id, {
      name: "Mains",
    });
    await createMenuItem(db, admin.id, menu.id, {
      categoryId: category.id,
      name: "Priced Dish",
      description: null,
      basePrice: 10000,
      availabilityStatus: "available",
      sortOrder: 10,
      variants: [],
      modifiers: [],
    });

    const results = await Promise.allSettled([
      publishMenu(db, admin.id, menu.id),
      publishMenu(db, admin.id, menu.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const published = await db
      .select({ id: menus.id })
      .from(menus)
      .where(eq(menus.status, "published"));
    expect(published).toHaveLength(1);
  });

  it("serializes concurrent applies of the same import", async () => {
    const admin = await seedUser(db, {
      email: "import-apply@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Apply Race Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Race Dish",
      basePriceMinor: 12500,
      decision: "accept",
    });

    const results = await Promise.allSettled([
      applyMenuImport(db, admin.id, record!.id),
      applyMenuImport(db, admin.id, record!.id),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const imported = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Race Dish"));
    expect(imported).toHaveLength(1);
    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(applied?.status).toBe("applied");
  });

  it("serializes accept-all against import application", async () => {
    const admin = await seedUser(db, {
      email: "import-accept-race@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Accept Race Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Dinner",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values([
      {
        importId: record!.id,
        categoryName: "Mains",
        name: "Accepted Dish",
        basePriceMinor: 15000,
        decision: "accept",
      },
      {
        importId: record!.id,
        categoryName: "Mains",
        name: "Pending Dish",
        basePriceMinor: 16000,
        decision: "pending",
      },
    ]);

    const [applyResult, acceptResult] = await Promise.allSettled([
      applyMenuImport(db, admin.id, record!.id),
      acceptAllImportItems(db, admin.id, record!.id),
    ]);

    expect(applyResult.status).toBe("fulfilled");
    if (acceptResult.status === "rejected") {
      expect(acceptResult.reason).toBeInstanceOf(ConflictError);
    }
    const accepted = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Accepted Dish"));
    expect(accepted).toHaveLength(1);
    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(applied?.status).toBe("applied");
  });

  it("serializes item edits against import application", async () => {
    const admin = await seedUser(db, {
      email: "import-edit-race@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Edit Race Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Brunch",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Accepted Dish",
      basePriceMinor: 15000,
      decision: "accept",
    });
    const [pending] = await db
      .insert(menuImportItems)
      .values({
        importId: record!.id,
        categoryName: "Mains",
        name: "Pending Dish",
        basePriceMinor: 16000,
        decision: "pending",
      })
      .returning();

    const [applyResult, editResult] = await Promise.allSettled([
      applyMenuImport(db, admin.id, record!.id),
      updateImportItem(db, admin.id, record!.id, pending!.id, {
        decision: "accept",
        categoryName: "Mains",
        name: "Pending Dish",
        basePrice: "160.00",
        availabilityStatus: "available",
      }),
    ]);

    expect(applyResult.status).toBe("fulfilled");
    if (editResult.status === "rejected") {
      expect(editResult.reason).toBeInstanceOf(ConflictError);
    }

    const accepted = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Accepted Dish"));
    const pendingImported = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Pending Dish"));
    expect(accepted).toHaveLength(1);
    expect(pendingImported).toHaveLength(
      editResult.status === "fulfilled" ? 1 : 0,
    );

    const [staged] = await db
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.id, pending!.id));
    expect(staged?.decision).toBe(
      editResult.status === "fulfilled" ? "accept" : "pending",
    );

    const [applied] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(applied?.status).toBe("applied");
  });

  it("rejects all mutations after an import has been applied", async () => {
    const admin = await seedUser(db, {
      email: "import-applied@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Applied Import Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Supper",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Mains",
      name: "Applied Dish",
      basePriceMinor: 18000,
      decision: "accept",
    });
    const [pending] = await db
      .insert(menuImportItems)
      .values({
        importId: record!.id,
        categoryName: "Mains",
        name: "Later Dish",
        basePriceMinor: 19000,
        decision: "pending",
      })
      .returning();

    await applyMenuImport(db, admin.id, record!.id);

    await expect(
      updateImportItem(db, admin.id, record!.id, pending!.id, {
        decision: "accept",
        categoryName: "Mains",
        name: "Later Dish",
        basePrice: "190.00",
        availabilityStatus: "available",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      acceptAllImportItems(db, admin.id, record!.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateImportCategoryDecision(db, admin.id, record!.id, "Mains", "reject"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      keepOnlyImportCategory(db, admin.id, record!.id, "Mains"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      applyMenuImport(db, admin.id, record!.id),
    ).rejects.toBeInstanceOf(ConflictError);

    const imported = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Applied Dish"));
    const later = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Later Dish"));
    expect(imported).toHaveLength(1);
    expect(later).toHaveLength(0);
  }, 20_000);

  it("rolls back all menu writes when application fails", async () => {
    const admin = await seedUser(db, {
      email: "import-rollback@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Rollback Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Late Night",
    });
    await createCategory(db, admin.id, menu.id, { name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status: "needs_review",
      })
      .returning();
    await db.insert(menuImportItems).values({
      importId: record!.id,
      categoryName: "Atomic Category",
      name: "Invalid Variant Dish",
      basePriceMinor: null,
      variants: [{ name: "Small", priceMinor: -1 }],
      decision: "accept",
    });

    await expect(
      applyMenuImport(db, admin.id, record!.id),
    ).rejects.toThrow();

    const categories = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.name, "Atomic Category"));
    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.name, "Invalid Variant Dish"));
    expect(categories).toHaveLength(0);
    expect(items).toHaveLength(0);

    const [imported] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record!.id));
    expect(imported?.status).toBe("needs_review");
  }, 20_000);
});
