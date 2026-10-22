import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, History, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { getDb } from "@/db/client";
import { requireAdminUser } from "@/lib/auth/guards";
import {
  AUDIT_PAGE_SIZE,
  listAuditHistory,
} from "@/server/services/audit-history";

export const metadata: Metadata = {
  title: "Audit history",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function pageHref(
  filters: { action: string; entityType: string; actor: string },
  page: number,
): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.actor) params.set("actor", filters.actor);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/dashboard/audit?${query}` : "/dashboard/audit";
}

function humanizeAction(action: string): string {
  return action.replaceAll("_", " ");
}

function withActiveOption(options: string[], active: string): string[] {
  if (!active || options.includes(active)) return options;
  return [...options, active];
}

function formatDetails(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const entries = Object.entries(details);
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
}

export default async function AuditHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdminUser();
  const query = await searchParams;
  const action = first(query.action);
  const entityType = first(query.entityType);
  const actor = first(query.actor);
  const pageParam = Number.parseInt(first(query.page), 10);

  const data = await listAuditHistory(getDb(), admin.id, {
    action: action || undefined,
    entityType: entityType || undefined,
    actor: actor || undefined,
    page: Number.isFinite(pageParam) ? pageParam : 1,
  });

  const filters = { action, entityType, actor };
  const actionOptions = withActiveOption(data.actions, action);
  const entityTypeOptions = withActiveOption(data.entityTypes, entityType);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<History className="h-5 w-5" aria-hidden="true" />}
        title="Audit history"
        description="Every sign-in, permission change, menu update, publish, and import is recorded with the actor and timestamp. IP addresses are never stored."
      />

      <Card>
        <CardBody>
          <form
            action="/dashboard/audit"
            method="get"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[12rem_12rem_1fr_auto]"
          >
            <Field
              id="audit-action"
              label="Action"
              note="Filter by what happened."
              noteLayout="below"
            >
              {(control) => (
                <Select {...control} name="action" defaultValue={action}>
                  <option value="">All actions</option>
                  {actionOptions.map((value) => (
                    <option key={value} value={value}>
                      {humanizeAction(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="audit-entity"
              label="Entity"
              note="Restaurants, menus, users, and more."
              noteLayout="below"
            >
              {(control) => (
                <Select {...control} name="entityType" defaultValue={entityType}>
                  <option value="">All entities</option>
                  {entityTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {humanizeAction(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="audit-actor"
              label="Actor email"
              note="Exact or partial email of the person who made the change."
              noteLayout="below"
            >
              {(control) => (
                <Input
                  {...control}
                  name="actor"
                  defaultValue={actor}
                  placeholder="name@example.com"
                />
              )}
            </Field>

            <div className="flex items-start gap-2 lg:pt-6">
              <button
                type="submit"
                className={buttonClass({ variant: "secondary" })}
              >
                Filter
              </button>
              <Link
                href="/dashboard/audit"
                className={buttonClass({ variant: "outline" })}
              >
                Reset
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          icon={<ShieldCheck className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
          title="Events"
          description={`${data.total} event${data.total === 1 ? "" : "s"} · page ${data.page} of ${data.pageCount}`}
        />

        {data.logs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No events match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {data.logs.map((log) => {
              const details = formatDetails(log.details);
              return (
                <li key={log.id} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral" className="capitalize">
                      {humanizeAction(log.action)}
                    </Badge>
                    <span className="text-xs text-zinc-500">
                      {log.entityType}
                    </span>
                    {log.entityId ? (
                      <span
                        className="font-mono text-[11px] text-zinc-400"
                        title={log.entityId}
                      >
                        {log.entityId.slice(0, 8)}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-zinc-400">
                      {dateFormatter.format(log.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">
                    {log.actorEmail ?? "System"}
                  </p>
                  {details ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-800">
                        Details
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded-lg bg-zinc-50 p-3 text-[11px] leading-5 text-zinc-600">
                        {details}
                      </pre>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {data.pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 sm:px-6">
            {data.page > 1 ? (
              <Link
                href={pageHref(filters, data.page - 1)}
                className={buttonClass({ variant: "outline", size: "sm" })}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-zinc-400">
              Showing up to {AUDIT_PAGE_SIZE} per page
            </span>
            {data.page < data.pageCount ? (
              <Link
                href={pageHref(filters, data.page + 1)}
                className={buttonClass({ variant: "outline", size: "sm" })}
              >
                Older
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
