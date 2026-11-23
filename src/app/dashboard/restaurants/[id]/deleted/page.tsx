import type { Metadata } from "next";
import { ArrowRight, BookOpen, ScanLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db/client";
import { requireAdminUser } from "@/lib/auth/guards";
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

function dayLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

function purgeDate(deletedAt: Date, retentionDays: number): Date {
  return new Date(deletedAt.getTime() + retentionDays * DAY_MS);
}

export default async function DeletedItemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminUser();
  const { id } = await params;

  let restaurant;
  let data;
  try {
    const access = await getRestaurantAccess(getDb(), admin.id, id);
    restaurant = access.restaurant;
    data = await listDeletedItems(getDb(), admin.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const retentionLabel = dayLabel(data.retentionDays);

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

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <BookOpen className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Deleted menus
          </h2>
          <span className="text-xs text-zinc-500">
            {data.menus.length} menu{data.menus.length === 1 ? "" : "s"}
          </span>
        </div>

        {data.menus.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
            title="No deleted menus"
            description="Menus deleted from this restaurant will appear here with a link to their read-only content and version history."
          />
        ) : (
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
                      {menu.hadPublished ? " · had a published version" : ""}
                    </p>
                  </div>

                  <Link
                    href={`/dashboard/restaurants/${restaurant.id}/menus/${menu.menuId}`}
                    className={buttonClass({ variant: "outline", size: "sm" })}
                  >
                    Open read-only menu
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <ScanLine className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Deleted scans
          </h2>
          <span className="text-xs text-zinc-500">
            {data.scans.length} scan{data.scans.length === 1 ? "" : "s"}
          </span>
        </div>

        {data.scans.length === 0 ? (
          <EmptyState
            icon={<ScanLine className="h-6 w-6" aria-hidden="true" />}
            title="No deleted scans"
            description="Scans deleted from the scan history will appear here until their retention period ends."
          />
        ) : (
          <ul className="space-y-3">
            {data.scans.map((scan) => (
              <li
                key={scan.id}
                className="rounded-2xl border border-zinc-200 bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTones[scan.status] ?? "neutral"}>
                        {scan.status.replaceAll("_", " ")}
                      </Badge>
                      <Link
                        href={`/dashboard/restaurants/${restaurant.id}/deleted/scans/${scan.id}`}
                        className="text-sm font-medium text-zinc-800 hover:text-accent-strong hover:underline"
                      >
                        {scan.menuTitle ?? "Target menu removed"}
                      </Link>
                      {scan.menuStatus ? (
                        <span className="text-xs capitalize text-zinc-400">
                          ({scan.menuStatus})
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Deleted {dateFormatter.format(scan.deletedAt)}
                      {scan.deletedByEmail
                        ? ` by ${scan.deletedByEmail}`
                        : ""}{" "}
                      · {scan.pageCount} page
                      {scan.pageCount === 1 ? "" : "s"} · {scan.itemCount}{" "}
                      extracted item{scan.itemCount === 1 ? "" : "s"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Uploaded {dateFormatter.format(scan.createdAt)} ·
                      Permanently removed after{" "}
                      {dateFormatter.format(
                        purgeDate(scan.deletedAt, data.retentionDays),
                      )}
                    </p>
                  </div>

                  <Link
                    href={`/dashboard/restaurants/${restaurant.id}/deleted/scans/${scan.id}`}
                    className={buttonClass({ variant: "outline", size: "sm" })}
                  >
                    View scan
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
