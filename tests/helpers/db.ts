import type { DbClient } from "@/db/client";
import { restaurants, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

import { createEphemeralDb, type EphemeralDb } from "../db/ephemeral-db";

export const TEST_PASSWORD = "Correct-Horse-Battery-9!";

export async function openTestDb(): Promise<{
  handle: EphemeralDb;
  db: DbClient;
}> {
  const handle = await createEphemeralDb();
  return { handle, db: handle.db as unknown as DbClient };
}

export async function resetTestDb(handle: EphemeralDb): Promise<void> {
  await handle.client.exec(`
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
}

export async function seedUser(
  db: DbClient,
  input: {
    email: string;
    name?: string;
    role?: "admin" | "authorized_user";
    status?: "invited" | "active" | "deactivated";
    password?: string | null;
  },
) {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name ?? input.email.split("@")[0] ?? "Test User",
      email: input.email,
      role: input.role ?? "authorized_user",
      accountStatus: input.status ?? "active",
      passwordHash:
        input.password === null
          ? null
          : await hashPassword(input.password ?? TEST_PASSWORD),
    })
    .returning();
  return user!;
}

export async function seedRestaurant(
  db: DbClient,
  input: { name?: string; slug?: string } = {},
) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [restaurant] = await db
    .insert(restaurants)
    .values({
      name: input.name ?? "Test Restaurant",
      slug: input.slug ?? `test-restaurant-${suffix}`,
    })
    .returning();
  return restaurant!;
}
