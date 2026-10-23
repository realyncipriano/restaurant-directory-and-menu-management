import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { rateLimits } from "@/db/schema";
import {
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
} from "@/lib/errors";
import {
  requireActiveActor,
  requireAdminActor,
} from "@/server/services/auth/actors";
import { enforceActivationRateLimit } from "@/server/services/auth/limits";
import {
  findUsableToken,
  invalidateUserTokens,
  issueToken,
  markTokenUsed,
} from "@/server/services/auth/token-store";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";
import type { EphemeralDb } from "./ephemeral-db";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000);
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("authentication helper services (ephemeral PGlite)", () => {
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

  it("requires an existing active actor", async () => {
    const invited = await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
    });
    const deactivated = await seedUser(db, {
      email: "deactivated@example.com",
      status: "deactivated",
    });
    const active = await seedUser(db, { email: "active@example.com" });

    await expect(
      requireActiveActor(db, MISSING_ID),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      requireActiveActor(db, invited.id),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      requireActiveActor(db, deactivated.id),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(requireActiveActor(db, active.id)).resolves.toMatchObject({
      id: active.id,
      accountStatus: "active",
    });
  });

  it("requires an active administrator", async () => {
    const member = await seedUser(db, { email: "member@example.com" });
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const invitedAdmin = await seedUser(db, {
      email: "invited-admin@example.com",
      role: "admin",
      status: "invited",
    });

    await expect(
      requireAdminActor(db, MISSING_ID),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      requireAdminActor(db, member.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requireAdminActor(db, invitedAdmin.id),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(requireAdminActor(db, admin.id)).resolves.toMatchObject({
      id: admin.id,
      role: "admin",
    });
  });

  it("rejects expired and invalid tokens", async () => {
    const invited = await seedUser(db, {
      email: "expired@example.com",
      status: "invited",
    });
    const expired = await issueToken(db, {
      userId: invited.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: NOW,
      now: NOW,
    });

    expect(await findUsableToken(db, expired, ["invite"], NOW)).toBeNull();
    expect(await findUsableToken(db, "short", ["invite"], NOW)).toBeNull();
    expect(
      await findUsableToken(db, "x".repeat(201), ["invite"], NOW),
    ).toBeNull();
    expect(
      await findUsableToken(db, "x".repeat(43), ["invite"], NOW),
    ).toBeNull();
  });

  it("rejects tokens issued for another purpose", async () => {
    const active = await seedUser(db, { email: "active@example.com" });
    const reset = await issueToken(db, {
      userId: active.id,
      purpose: "password_reset",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });

    expect(await findUsableToken(db, reset, ["invite"], NOW)).toBeNull();
    expect(
      await findUsableToken(db, reset, ["password_reset"], NOW),
    ).not.toBeNull();
  });

  it("checks account status during token lookup", async () => {
    const active = await seedUser(db, { email: "active@example.com" });
    const invited = await seedUser(db, {
      email: "invited@example.com",
      status: "invited",
    });
    const deactivated = await seedUser(db, {
      email: "deactivated@example.com",
      status: "deactivated",
    });

    const inviteForActive = await issueToken(db, {
      userId: active.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    const resetForInvited = await issueToken(db, {
      userId: invited.id,
      purpose: "password_reset",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    const resetForDeactivated = await issueToken(db, {
      userId: deactivated.id,
      purpose: "password_reset",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    const inviteForInvited = await issueToken(db, {
      userId: invited.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    const resetForActive = await issueToken(db, {
      userId: active.id,
      purpose: "password_reset",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });

    expect(
      await findUsableToken(db, inviteForActive, ["invite"], NOW),
    ).toBeNull();
    expect(
      await findUsableToken(db, resetForInvited, ["password_reset"], NOW),
    ).toBeNull();
    expect(
      await findUsableToken(db, resetForDeactivated, ["password_reset"], NOW),
    ).toBeNull();
    expect(
      await findUsableToken(db, inviteForInvited, ["invite"], NOW),
    ).not.toBeNull();
    expect(
      await findUsableToken(db, resetForActive, ["password_reset"], NOW),
    ).not.toBeNull();
  });

  it("marks tokens as used exactly once", async () => {
    const invited = await seedUser(db, {
      email: "single-use@example.com",
      status: "invited",
    });
    const token = await issueToken(db, {
      userId: invited.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    const row = await findUsableToken(db, token, ["invite"], NOW);
    if (!row) throw new Error("Expected a usable token.");

    expect(await markTokenUsed(db, row.tokenId, NOW)).toBe(true);
    expect(await markTokenUsed(db, row.tokenId, NOW)).toBe(false);
    expect(await findUsableToken(db, token, ["invite"], NOW)).toBeNull();
  });

  it("invalidates outstanding tokens while allowing new ones", async () => {
    const invited = await seedUser(db, {
      email: "invalidate@example.com",
      status: "invited",
    });
    const first = await issueToken(db, {
      userId: invited.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    const second = await issueToken(db, {
      userId: invited.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });

    await invalidateUserTokens(db, invited.id, NOW);

    expect(await findUsableToken(db, first, ["invite"], NOW)).toBeNull();
    expect(await findUsableToken(db, second, ["invite"], NOW)).toBeNull();

    const third = await issueToken(db, {
      userId: invited.id,
      purpose: "invite",
      createdBy: null,
      expiresAt: FUTURE,
      now: NOW,
    });
    expect(await findUsableToken(db, third, ["invite"], NOW)).not.toBeNull();
  });

  it("preserves activation rate-limit keys and limits", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await enforceActivationRateLimit(db, "ip-hash", NOW);
    }

    await expect(
      enforceActivationRateLimit(db, "ip-hash", NOW),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, "activation-ip:ip-hash"));
    expect(row?.count).toBe(11);

    await expect(
      enforceActivationRateLimit(db, null, NOW),
    ).resolves.toBeUndefined();
  });
});
