import "server-only";

import { inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { appSettings } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { getAppName } from "@/lib/env";
import {
  appSettingsSchema,
  type AppSettingsInput,
} from "@/lib/validation/settings";
import { parseOrThrow } from "@/lib/validation/parse";
import { writeAuditLog } from "./audit";
import { requireAdminActor } from "./auth";

export const APP_SETTING_KEYS = {
  siteName: "site_name",
  siteTagline: "site_tagline",
  supportEmail: "support_email",
} as const;

const ALL_KEYS = Object.values(APP_SETTING_KEYS);
const DEFAULT_TAGLINE = "Restaurant menus and prices";

export type AppSettings = {
  siteName: string;
  siteTagline: string;
  supportEmail: string | null;
};

function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function defaultAppSettings(): AppSettings {
  return {
    siteName: getAppName(),
    siteTagline: DEFAULT_TAGLINE,
    supportEmail: null,
  };
}

export async function getAppSettings(db: DbExecutor): Promise<AppSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, ALL_KEYS));

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const defaults = defaultAppSettings();

  return {
    siteName: clean(byKey.get(APP_SETTING_KEYS.siteName), 80) ?? defaults.siteName,
    siteTagline:
      clean(byKey.get(APP_SETTING_KEYS.siteTagline), 160) ?? defaults.siteTagline,
    supportEmail: clean(byKey.get(APP_SETTING_KEYS.supportEmail), 254),
  };
}

export async function updateAppSettings(
  db: DbClient,
  actorId: string,
  input: AppSettingsInput,
): Promise<AppSettings> {
  const actor = await requireAdminActor(db, actorId);
  const parsed = parseOrThrow(appSettingsSchema, input);

  await db.transaction(async (tx) => {
    await tx.delete(appSettings).where(inArray(appSettings.key, ALL_KEYS));

    const values: { key: string; value: string; updatedBy: string }[] = [
      { key: APP_SETTING_KEYS.siteName, value: parsed.siteName, updatedBy: actor.id },
    ];
    if (parsed.siteTagline) {
      values.push({
        key: APP_SETTING_KEYS.siteTagline,
        value: parsed.siteTagline,
        updatedBy: actor.id,
      });
    }
    if (parsed.supportEmail) {
      values.push({
        key: APP_SETTING_KEYS.supportEmail,
        value: parsed.supportEmail,
        updatedBy: actor.id,
      });
    }

    await tx.insert(appSettings).values(values);

    await writeAuditLog(tx, {
      actor: { id: actor.id, email: actor.email },
      action: "settings_updated",
      entityType: "app_settings",
      entityId: "global",
      details: {
        siteName: parsed.siteName,
        siteTagline: parsed.siteTagline || null,
        supportEmail: parsed.supportEmail || null,
      },
    });
  });

  return getAppSettings(db);
}
