import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";

export const READINESS_TIMEOUT_MS = 5_000;

export class ReadinessTimeoutError extends Error {
  constructor() {
    super("Readiness check timed out.");
    this.name = "ReadinessTimeoutError";
  }
}

/**
 * Runs the smallest possible database round trip. The result is intentionally
 * not returned to callers: the readiness route only needs to know whether the
 * dependency answered within the timeout.
 */
export async function probeDatabaseReadiness(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ReadinessTimeoutError()),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
