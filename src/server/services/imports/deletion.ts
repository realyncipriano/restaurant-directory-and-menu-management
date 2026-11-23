import "server-only";

import { and, eq, isNull, ne } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { menuImports } from "@/db/schema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "../audit";
import { requireRestaurantPermission } from "../restaurant-access";

export async function softDeleteMenuImport(
  db: DbClient,
  actorId: string,
  importId: string,
): Promise<void> {
  const [record] = await db
    .select()
    .from(menuImports)
    .where(eq(menuImports.id, importId))
    .limit(1);
  if (!record) throw new NotFoundError("Import not found.");

  const access = await requireRestaurantPermission(
    db,
    actorId,
    record.restaurantId,
    "editMenu",
  );

  if (record.deletedAt) return;
  if (record.status === "processing") {
    throw new ConflictError(
      "This scan is still being processed. Wait for it to finish before deleting it.",
    );
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(menuImports)
      .set({
        deletedAt: now,
        deletedBy: access.actor.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(menuImports.id, importId),
          isNull(menuImports.deletedAt),
          ne(menuImports.status, "processing"),
        ),
      )
      .returning({ id: menuImports.id });

    if (!updated) {
      // A concurrent request may have deleted the scan, or processing may
      // have started after the initial read. Distinguish the two cases so
      // repeated deletes stay idempotent.
      const [current] = await tx
        .select({
          deletedAt: menuImports.deletedAt,
          status: menuImports.status,
        })
        .from(menuImports)
        .where(eq(menuImports.id, importId))
        .limit(1);

      if (!current) throw new NotFoundError("Import not found.");
      if (current.deletedAt) return;
      throw new ConflictError(
        "This scan is still being processed. Wait for it to finish before deleting it.",
      );
    }

    await writeAuditLog(tx, {
      actor: { id: access.actor.id, email: access.actor.email },
      action: "import_deleted",
      entityType: "import",
      entityId: importId,
      details: {
        restaurantId: record.restaurantId,
        menuId: record.menuId,
        status: record.status,
        deletedAt: now.toISOString(),
      },
    });
  });
}
