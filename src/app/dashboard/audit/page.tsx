import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, History, ShieldCheck } from "lucide-react";
import Link from "next/link";

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
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900">
          <History className="h-6 w-6 text-amber-700" aria-hidden="true" />
          Audit history
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Every sign-in, permission change, menu update, publish, and import is
          recorded with the actor and timestamp. IP addresses are never stored.
        </p>
      </div>

      <form
        action="/dashboard/audit"
        method="get"
        className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:grid-cols-[12rem_12rem_1fr_auto]"
      >
        <label className="block text-xs font-medium text-zinc-700">
          Action
          <select
            name="action"
            defaultValue={action}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none"
          >
            <option value="">All actions</option>
            {actionOptions.map((value) => (
              <option key={value} value={value}>
                {humanizeAction(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-700">
          Entity
          <select
            name="entityType"
            defaultValue={entityType}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none"
          >
            <option value="">All entities</option>
            {entityTypeOptions.map((value) => (
              <option key={value} value={value}>
                {humanizeAction(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-700">
          Actor email
          <input
            name="actor"
            defaultValue={actor}
            placeholder="name@example.com"
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none"
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            Filter
          </button>
          <Link
            href="/dashboard/audit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-zinc-900">Events</h2>
          </div>
          <p className="text-xs text-zinc-500">
            {data.total} event{data.total === 1 ? "" : "s"} · page {data.page} of{" "}
            {data.pageCount}
          </p>
        </div>

        {data.logs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No events match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {data.logs.map((log) => {
              const details = formatDetails(log.details);
              return (
                <li key={log.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium capitalize text-zinc-700">
                      {humanizeAction(log.action)}
                    </span>
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
          <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3">
            {data.page > 1 ? (
              <Link
                href={pageHref(filters, data.page - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
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
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Older
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
