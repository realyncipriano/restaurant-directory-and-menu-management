import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { appSettings, auditLogs } from "@/db/schema";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  APP_SETTING_KEYS,
  defaultAppSettings,
  getAppSettings,
  updateAppSettings,
} from "@/server/services/app-settings";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

describe("app settings (ephemeral PGlite)", () => {
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

  async function setup() {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    return { admin, member };
  }

  it("falls back to defaults when no settings are stored", async () => {
    await setup();

    const settings = await getAppSettings(db);
    expect(settings).toEqual(defaultAppSettings());
    expect(settings.supportEmail).toBeNull();
  });

  it("stores settings and records an audit event", async () => {
    const { admin } = await setup();

    const saved = await updateAppSettings(db, admin.id, {
      siteName: "Tara Kain",
      siteTagline: "Menus near you",
      supportEmail: "Help@Example.com",
    });

    expect(saved.siteName).toBe("Tara Kain");
    expect(saved.siteTagline).toBe("Menus near you");
    expect(saved.supportEmail).toBe("help@example.com");

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, APP_SETTING_KEYS.siteName));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedBy).toBe(admin.id);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "settings_updated"));
    expect(audits).toHaveLength(1);
  });

  it("restores defaults when optional fields are cleared", async () => {
    const { admin } = await setup();

    await updateAppSettings(db, admin.id, {
      siteName: "Tara Kain",
      siteTagline: "Menus near you",
      supportEmail: "help@example.com",
    });

    const cleared = await updateAppSettings(db, admin.id, {
      siteName: "Tara Kain",
      siteTagline: "",
      supportEmail: "",
    });

    expect(cleared.siteTagline).toBe(defaultAppSettings().siteTagline);
    expect(cleared.supportEmail).toBeNull();
  });

  it("rejects invalid values and non-admin actors", async () => {
    const { admin, member } = await setup();

    await expect(
      updateAppSettings(db, member.id, {
        siteName: "Nope",
        siteTagline: "",
        supportEmail: "",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      updateAppSettings(db, admin.id, {
        siteName: "Tara Kain",
        siteTagline: "",
        supportEmail: "not-an-email",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      updateAppSettings(db, admin.id, {
        siteName: "",
        siteTagline: "",
        supportEmail: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
