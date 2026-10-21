import { auditLogs } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

export type AuditActor = {
  id: string;
  email: string;
};

export async function writeAuditLog(
  db: DbExecutor,
  entry: {
    actor?: AuditActor | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actor?.id ?? null,
    actorEmail: entry.actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: entry.details ?? null,
  });
}
