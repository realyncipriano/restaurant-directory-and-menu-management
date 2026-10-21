import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  type SQL,
} from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { requireAdminActor } from "./auth";

export const AUDIT_PAGE_SIZE = 40;

export type AuditLogFilters = {
  action?: string;
  entityType?: string;
  actor?: string;
  page?: number;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listAuditHistory(
  db: DbClient,
  actorId: string,
  filters: AuditLogFilters,
) {
  await requireAdminActor(db, actorId);

  const conditions: SQL[] = [];
  if (filters.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }
  if (filters.entityType) {
    conditions.push(eq(auditLogs.entityType, filters.entityType));
  }
  if (filters.actor?.trim()) {
    conditions.push(
      ilike(auditLogs.actorEmail, `%${escapeLike(filters.actor.trim())}%`),
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ total: count() })
    .from(auditLogs)
    .where(where);
  const total = totalRow?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(
    Math.max(1, Math.floor(filters.page ?? 1)),
    pageCount,
  );

  const logs = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);

  const actions = await db
    .selectDistinct({ value: auditLogs.action })
    .from(auditLogs)
    .orderBy(asc(auditLogs.action));

  const entityTypes = await db
    .selectDistinct({ value: auditLogs.entityType })
    .from(auditLogs)
    .orderBy(asc(auditLogs.entityType));

  return {
    logs,
    total,
    page,
    pageCount,
    actions: actions.map((row) => row.value),
    entityTypes: entityTypes.map((row) => row.value),
  };
}
