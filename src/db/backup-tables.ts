import type { PgTable } from "drizzle-orm/pg-core";

import {
  appSettings,
  auditLogs,
  authTokens,
  menuCategories,
  menuChangeLogs,
  menuImportItems,
  menuImportPages,
  menuImports,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
  mfaChallenges,
  mfaRecoveryCodes,
  rateLimits,
  restaurantUserPermissions,
  restaurants,
  sessions,
  users,
} from "./schema";

export type BackupTableSpec = {
  name: string;
  table: PgTable;
  primaryKey: readonly string[];
  selfReference?: string;
};

/**
 * Insert order follows foreign-key dependencies. Self-referencing tables are
 * ordered row by row during restore.
 */
export const BACKUP_TABLES: readonly BackupTableSpec[] = [
  { name: "users", table: users, primaryKey: ["id"] },
  { name: "restaurants", table: restaurants, primaryKey: ["id"] },
  {
    name: "restaurant_user_permissions",
    table: restaurantUserPermissions,
    primaryKey: ["id"],
  },
  {
    name: "menus",
    table: menus,
    primaryKey: ["id"],
    selfReference: "clonedFromMenuId",
  },
  { name: "menu_categories", table: menuCategories, primaryKey: ["id"] },
  { name: "menu_items", table: menuItems, primaryKey: ["id"] },
  { name: "menu_item_variants", table: menuItemVariants, primaryKey: ["id"] },
  { name: "menu_item_modifiers", table: menuItemModifiers, primaryKey: ["id"] },
  { name: "menu_imports", table: menuImports, primaryKey: ["id"] },
  { name: "menu_import_pages", table: menuImportPages, primaryKey: ["id"] },
  {
    name: "menu_import_items",
    table: menuImportItems,
    primaryKey: ["id"],
    selfReference: "duplicateOfImportItemId",
  },
  { name: "menu_change_logs", table: menuChangeLogs, primaryKey: ["id"] },
  { name: "app_settings", table: appSettings, primaryKey: ["key"] },
  { name: "audit_logs", table: auditLogs, primaryKey: ["id"] },
  { name: "auth_tokens", table: authTokens, primaryKey: ["id"] },
  { name: "mfa_challenges", table: mfaChallenges, primaryKey: ["id"] },
  {
    name: "mfa_recovery_codes",
    table: mfaRecoveryCodes,
    primaryKey: ["id"],
  },
  { name: "rate_limits", table: rateLimits, primaryKey: ["key"] },
  { name: "sessions", table: sessions, primaryKey: ["id"] },
];

export const BACKUP_TABLE_BY_NAME = new Map(
  BACKUP_TABLES.map((spec) => [spec.name, spec]),
);
