import type { DbClient } from "@/db/client";
import {
  ACTIVATION_IP_LIMIT,
  ACTIVATION_WINDOW_SECONDS,
  consumeRateLimit,
} from "@/lib/auth/rate-limit";
import { RateLimitedError } from "@/lib/errors";

export async function enforceActivationRateLimit(
  db: DbClient,
  ipHash: string | null | undefined,
  now: Date,
): Promise<void> {
  if (!ipHash) return;
  const result = await consumeRateLimit(db, {
    key: `activation-ip:${ipHash}`,
    limit: ACTIVATION_IP_LIMIT,
    windowSeconds: ACTIVATION_WINDOW_SECONDS,
    now,
  });
  if (!result.allowed) {
    throw new RateLimitedError(result.retryAfterSeconds);
  }
}
