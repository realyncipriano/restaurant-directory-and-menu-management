import "server-only";

import { and, asc, inArray, isNotNull, lte, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { menuImportPages, menuImports } from "@/db/schema";
import { getAppSettings } from "../app-settings";
import { writeAuditLog } from "../audit";
import { deletePrivateObject } from "../storage";

export const IMPORT_PURGE_BATCH_SIZE = 25;

const IMPORT_PURGE_LOCK = "rdmm.import-purge";
const DAY_MS = 24 * 60 * 60 * 1000;

export type PurgeExpiredImportsResult = {
  purged: number;
  retentionDays: number;
};

/**
 * Permanently removes scan history whose soft-delete grace period has ended.
 * Private source images are removed first so an interrupted run can be safely
 * repeated. Menu content is never touched; only the scan rows and their
 * cascading pages/items are deleted.
 */
export async function purgeExpiredMenuImports(
  db: DbClient,
  options: {
    now?: Date;
    retentionDays?: number;
    limit?: number;
  } = {},
): Promise<PurgeExpiredImportsResult> {
  const retentionDays =
    options.retentionDays ?? (await getAppSettings(db)).scanRetentionDays;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const limit = Math.max(1, options.limit ?? IMPORT_PURGE_BATCH_SIZE);

  const purged = await db.transaction(async (tx) => {
    // Serialize purges across requests. Without this, two scan-history page
    // loads could both try to remove the same objects and rows.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${IMPORT_PURGE_LOCK}))`,
    );

    const expired = await tx
      .select({
        id: menuImports.id,
        restaurantId: menuImports.restaurantId,
        menuId: menuImports.menuId,
        deletedAt: menuImports.deletedAt,
      })
      .from(menuImports)
      .where(
        and(
          isNotNull(menuImports.deletedAt),
          lte(menuImports.deletedAt, cutoff),
        ),
      )
      .orderBy(asc(menuImports.deletedAt))
      .limit(limit)
      .for("update");

    if (expired.length === 0) return 0;

    const ids = expired.map((row) => row.id);
    const pages = await tx
      .select({
        importId: menuImportPages.importId,
        key: menuImportPages.privateSourceObjectKey,
      })
      .from(menuImportPages)
      .where(inArray(menuImportPages.importId, ids));

    const pageCountByImport = new Map<string, number>();
    for (const page of pages) {
      pageCountByImport.set(
        page.importId,
        (pageCountByImport.get(page.importId) ?? 0) + 1,
      );
    }

    await Promise.all(
      pages.map((page) => deletePrivateObject(page.key)),
    );

    await tx.delete(menuImports).where(inArray(menuImports.id, ids));

    for (const row of expired) {
      await writeAuditLog(tx, {
        actor: null,
        action: "import_purged",
        entityType: "import",
        entityId: row.id,
        details: {
          restaurantId: row.restaurantId,
          menuId: row.menuId,
          deletedAt: row.deletedAt?.toISOString() ?? null,
          sourceObjects: pageCountByImport.get(row.id) ?? 0,
          retentionDays,
        },
      });
    }

    return expired.length;
  });

  return { purged, retentionDays };
}
