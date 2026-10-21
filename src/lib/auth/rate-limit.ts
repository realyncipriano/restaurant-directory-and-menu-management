import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/types";
import { rateLimits } from "@/db/schema";

type Executor = DbExecutor;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  db: Executor,
  options: {
    key: string;
    limit: number;
    windowSeconds: number;
    now?: Date;
  },
): Promise<RateLimitResult> {
  const now = options.now ?? new Date();
  const windowEndsAt = new Date(now.getTime() + options.windowSeconds * 1000);

  const [row] = await db
    .insert(rateLimits)
    .values({
      key: options.key,
      count: 1,
      windowEndsAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowEndsAt} <= ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowEndsAt: sql`CASE WHEN ${rateLimits.windowEndsAt} <= ${now} THEN excluded.window_ends_at ELSE ${rateLimits.windowEndsAt} END`,
        updatedAt: now,
      },
    })
    .returning({
      count: rateLimits.count,
      windowEndsAt: rateLimits.windowEndsAt,
    });

  if (!row) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: options.windowSeconds,
    };
  }

  const allowed = row.count <= options.limit;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((row.windowEndsAt.getTime() - now.getTime()) / 1000),
  );

  return {
    allowed,
    remaining: Math.max(0, options.limit - row.count),
    retryAfterSeconds,
  };
}

export async function resetRateLimit(
  db: Executor,
  key: string,
): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

export async function pruneExpiredRateLimits(
  db: Executor,
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await db
    .delete(rateLimits)
    .where(
      and(
        lt(rateLimits.windowEndsAt, cutoff),
        lt(rateLimits.updatedAt, cutoff),
      ),
    );
}

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_ACCOUNT_GLOBAL_WINDOW_SECONDS = 60 * 60;
export const LOGIN_ACCOUNT_GLOBAL_LIMIT = 50;
export const LOGIN_IP_LIMIT = 30;
export const CHANGE_PASSWORD_WINDOW_SECONDS = 15 * 60;
export const CHANGE_PASSWORD_LIMIT = 5;
export const ACTIVATION_WINDOW_SECONDS = 60 * 60;
export const ACTIVATION_IP_LIMIT = 10;
