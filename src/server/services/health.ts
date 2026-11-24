import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";

export const READINESS_TIMEOUT_MS = 5_000;
// Leave headroom for the outer response deadline while ensuring the database
// stops a slow probe instead of leaving it running after the 503 is returned.
export const READINESS_STATEMENT_TIMEOUT_MS = 4_000;

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
  const probe = getDb().transaction(async (tx) => {
    // SET LOCAL applies only to this transaction, so application queries keep
    // their normal timeout behavior. The server cancels the probe if it takes
    // too long, rather than leaving the query running in the background.
    await tx.execute(
      sql.raw(
        `set local statement_timeout = ${READINESS_STATEMENT_TIMEOUT_MS}`,
      ),
    );
    await tx.execute(sql`select 1`);
  });

  // If the response deadline wins, the transaction may reject later while the
  // database finishes cancelling it. Observe that rejection so it is not
  // reported as an unhandled promise rejection.
  probe.catch(() => {});

  try {
    await Promise.race([
      probe,
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
