import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  ScanLine,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { getDb } from "@/db/client";
import { requireAdminUser } from "@/lib/auth/guards";
import { cn } from "@/lib/cn";
import { NotFoundError } from "@/lib/errors";
import { listDeletedItems } from "@/server/services/deleted-items";
import { getRestaurantAccess } from "@/server/services/restaurant-access";

export const metadata: Metadata = {
  title: "Deleted items",
  robots: { index: false, follow: false },
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusTones: Record<string, BadgeTone> = {
  uploading: "info",
  uploaded: "neutral",
  processing: "info",
  needs_review: "warning",
  reviewed: "success",
  applied: "success",
  failed: "danger",
};

type DeletedTab = "menus" | "scans";

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function tabHref(restaurantId: string, tab: DeletedTab): string {
  const base = `/dashboard/restaurants/${restaurantId}/deleted`;
  return tab === "scans" ? `${base}?tab=scans` : base;
}

function scansPageHref(restaurantId: string, page: number): string {
  const params = new URLSearchParams({ tab: "scans" });
  if (page > 1) params.set("page", String(page));
  return `/dashboard/restaurants/${restaurantId}/deleted?${params.toString()}`;
}

function menusPageHref(restaurantId: string, page: number): string {
  const base = `/dashboard/restaurants/${restaurantId}/deleted`;
  return page > 1 ? `${base}?page=${page}` : base;
}

function dayLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

function purgeDate(deletedAt: Date, retentionDays: number): Date {
  return new Date(deletedAt.getTime() + retentionDays * DAY_MS);
}

export default async function DeletedItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    page?: string | string[];
  }>;
}) {
  const admin = await requireAdminUser();
  const { id } = await params;
  const query = await searchParams;
  const tab: DeletedTab = first(query.tab) === "scans" ? "scans" : "menus";
  const pageParam = Number.parseInt(first(query.page), 10);
  const requestedPage = Number.isFinite(pageParam) ? pageParam : 1;

  let restaurant;
  let data;
  try {
    const access = await getRestaurantAccess(getDb(), admin.id, id);
    restaurant = access.restaurant;
    data = await listDeletedItems(getDb(), admin.id, id, {
      page: requestedPage,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const retentionLabel = dayLabel(data.retentionDays);
  const firstMenu =
    data.menuTotal === 0 ? 0 : (data.menuPage - 1) * data.menuPageSize + 1;
  const lastMenu = Math.min(
    data.menuPage * data.menuPageSize,
    data.menuTotal,
  );
  const firstScan =
    data.scanTotal === 0 ? 0 : (data.scanPage - 1) * data.scanPageSize + 1;
  const lastScan = Math.min(
    data.scanPage * data.scanPageSize,
    data.scanTotal,
  );
  const tabClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-surface text-zinc-900 shadow-sm"
        : "text-zinc-500 hover:text-zinc-800",
    );

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}`}
        backLabel={restaurant.name}
        icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
        title="Deleted items"
        description="Archived menus and soft-deleted scans for this restaurant. This view is read-only; deleted items cannot be restored from the app."
      />

      <Notice tone="info">
        Deleted menus stay archived indefinitely. Deleted scans and their source
        images are permanently removed after {retentionLabel}. Deleting a scan
        never changes menu content.
      </Notice>

      <nav
        aria-label="Deleted item types"
        className="flex w-fit flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100/70 p-1"
      >
        <Link
          href={tabHref(restaurant.id, "menus")}
          aria-current={tab === "menus" ? "page" : undefined}
          className={tabClass(tab === "menus")}
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Deleted menus
          <span className="rounded-full bg-zinc-200/80 px-1.5 py-0.5 text-[11px] leading-none text-zinc-600">
            {data.menuTotal}
          </span>
        </Link>
        <Link
          href={tabHref(restaurant.id, "scans")}
          aria-current={tab === "scans" ? "page" : undefined}
          className={tabClass(tab === "scans")}
        >
          <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
          Deleted scans
          <span className="rounded-full bg-zinc-200/80 px-1.5 py-0.5 text-[11px] leading-none text-zinc-600">
            {data.scanTotal}
          </span>
        </Link>
      </nav>

      {tab === "menus" ? (
        <section className="space-y-4" aria-label="Deleted menus">
          {data.menuTotal === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
              title="No deleted menus"
              description="Menus deleted from this restaurant will appear here with a link to their read-only content and version history."
            />
          ) : (
            <>
              <PaginationControls
                ariaLabel="Deleted menus pagination"
                page={data.menuPage}
                pageCount={data.menuPageCount}
                firstItem={firstMenu}
                lastItem={lastMenu}
                total={data.menuTotal}
                hrefForPage={(page) => menusPageHref(restaurant.id, page)}
                className="border-b border-zinc-200 pb-4"
              />

              <ul className="space-y-3">
                {data.menus.map((menu) => (
                  <li
                    key={menu.lineageId}
                    className="rounded-2xl border border-zinc-200 bg-surface p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="danger">deleted</Badge>
                          <h3 className="text-sm font-semibold text-zinc-900">
                            {menu.title}
                          </h3>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                          /{menu.slug}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          Deleted {dateFormatter.format(menu.deletedAt)}
                          {menu.deletedByEmail
                            ? ` by ${menu.deletedByEmail}`
                            : ""}{" "}
                          · {menu.versionCount} version
                          {menu.versionCount === 1 ? "" : "s"}
                          {menu.hadPublished
                            ? " · had a published version"
                            : ""}
                        </p>
                      </div>

                      <Link
                        href={`/dashboard/restaurants/${restaurant.id}/menus/${menu.menuId}`}
                        className={buttonClass({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Open read-only menu
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>

              <PaginationControls
                ariaLabel="Deleted menus pagination"
                page={data.menuPage}
                pageCount={data.menuPageCount}
                firstItem={firstMenu}
                lastItem={lastMenu}
                total={data.menuTotal}
                hrefForPage={(page) => menusPageHref(restaurant.id, page)}
                className="border-t border-zinc-200 pt-4"
              />
            </>
          )}
        </section>
      ) : (
        <section className="space-y-4" aria-label="Deleted scans">
          {data.scanTotal === 0 ? (
            <EmptyState
              icon={<ScanLine className="h-6 w-6" aria-hidden="true" />}
              title="No deleted scans"
              description="Scans deleted from the scan history will appear here until their retention period ends."
            />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-zinc-100">
                {data.scans.map((scan) => {
                  const detailHref = `/dashboard/restaurants/${restaurant.id}/deleted/scans/${scan.id}`;
                  return (
                    <li key={scan.id} className="px-5 py-3 sm:px-6">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Badge tone={statusTones[scan.status] ?? "neutral"}>
                          {scan.status.replaceAll("_", " ")}
                        </Badge>
                        <Link
                          href={detailHref}
                          className="min-w-0 truncate text-sm font-medium text-zinc-800 hover:text-accent-strong hover:underline"
                        >
                          {scan.menuTitle ?? "Target menu removed"}
                        </Link>
                        {scan.menuStatus ? (
                          <span className="text-xs capitalize text-zinc-400">
                            {scan.menuStatus}
                          </span>
                        ) : null}
                        <span className="text-xs text-zinc-500">
                          Deleted {dateFormatter.format(scan.deletedAt)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {scan.pageCount} page
                          {scan.pageCount === 1 ? "" : "s"} · {scan.itemCount}{" "}
                          item{scan.itemCount === 1 ? "" : "s"}
                        </span>
                        <Link
                          href={detailHref}
                          aria-label={`View scan of ${scan.menuTitle ?? "removed menu"}`}
                          className={buttonClass({
                            variant: "outline",
                            size: "sm",
                            className: "ml-auto",
                          })}
                        >
                          View
                          <ArrowRight
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </Link>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-400">
                        {scan.deletedByEmail
                          ? `Deleted by ${scan.deletedByEmail} · `
                          : ""}
                        Uploaded {dateFormatter.format(scan.createdAt)} ·
                        Permanently removed after{" "}
                        {dateFormatter.format(
                          purgeDate(scan.deletedAt, data.retentionDays),
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>

              <PaginationControls
                ariaLabel="Deleted scans pagination"
                page={data.scanPage}
                pageCount={data.scanPageCount}
                firstItem={firstScan}
                lastItem={lastScan}
                total={data.scanTotal}
                hrefForPage={(page) => scansPageHref(restaurant.id, page)}
                className="border-t border-zinc-200 px-5 py-3 sm:px-6"
              />
            </Card>
          )}
        </section>
      )}

      <Card>
        <CardHeader
          icon={<Trash2 className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
          title="Need the audit trail?"
          description="Deletions and purges are recorded with the actor and timestamp."
        />
        <CardBody>
          <Link
            href="/dashboard/audit"
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            Open audit history
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
