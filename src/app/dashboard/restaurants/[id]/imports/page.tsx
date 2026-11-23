import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { StartImportForm } from "@/components/imports/start-import-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireCurrentUser } from "@/lib/auth/guards";
import {
  getExtractionConfig,
  isExtractionConfigured,
} from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { listMenuImports } from "@/server/services/imports";
import { listMenusForRestaurant } from "@/server/services/menus";
import { getRestaurantDetail } from "@/server/services/restaurants";
import { isPrivateStorageConfigured } from "@/server/services/storage";
import { deleteImportAction } from "./actions";

export const metadata: Metadata = {
  title: "Menu scans",
  robots: { index: false, follow: false },
};

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

export default async function MenuImportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const query = await searchParams;

  let detail;
  let data;
  let menus;
  try {
    detail = await getRestaurantDetail(getDb(), user.id, id);
    data = await listMenuImports(getDb(), user.id, id);
    menus = await listMenusForRestaurant(getDb(), user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { restaurant, flags } = detail;
  const canEdit = flags.canEditMenu && restaurant.status === "active";
  const canDelete = flags.canEditMenu;
  const draftMenus = menus
    .filter((menu) => menu.draft)
    .map((menu) => ({ id: menu.draft?.id ?? "", title: menu.title }))
    .filter((menu) => menu.id);
  const storageConfigured = isPrivateStorageConfigured();
  const extractionConfigured = isExtractionConfigured();
  const maxPages = getExtractionConfig()?.maxPages ?? 10;
  const error = typeof query.error === "string" ? query.error : undefined;
  const notice = typeof query.notice === "string" ? query.notice : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}/menus`}
        backLabel="Menus"
        title="Menu scans"
        description="Upload menu photos, extract items into a review queue, and apply only the items you accept to a draft menu. Published menus are never changed directly."
      />

      {notice === "scan-deleted" ? (
        <Notice tone="success">
          Scan deleted from history. Menu content was not changed. The scan and
          its source images will be permanently removed after{" "}
          {data.retentionDays} day{data.retentionDays === 1 ? "" : "s"}.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="error">
          {error === "delete-scan"
            ? "The scan could not be deleted. It may still be processing, or you may not have permission."
            : "The action could not be completed. Please try again."}
        </Notice>
      ) : null}

      {!extractionConfigured ? (
        <Notice tone="warning" title="Menu extraction is not configured">
          You can upload scans, but processing stays disabled until an extraction
          provider and API key are set. Manual menu entry remains available.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">Scan history</h2>
            <span className="text-xs text-zinc-500">
              {data.imports.length} scan{data.imports.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-xs leading-5 text-zinc-500">
            Deleting a scan removes only its history. Applied menu changes stay
            in place. Deleted scans are permanently removed after{" "}
            {data.retentionDays} day{data.retentionDays === 1 ? "" : "s"}.
          </p>

          {data.imports.length === 0 ? (
            <EmptyState
              icon={<ScanLine className="h-6 w-6" aria-hidden="true" />}
              title="No scans yet"
              description="Upload menu photos to start an import. Extracted items always go through review first."
            />
          ) : (
            <ul className="space-y-3">
              {data.imports.map(({ menuImport, menuTitle, menuStatus }) => {
                const errorMessage =
                  menuImport.errorDetails &&
                  typeof menuImport.errorDetails.message === "string"
                    ? menuImport.errorDetails.message
                    : null;
                const retentionLabel = `${data.retentionDays} day${data.retentionDays === 1 ? "" : "s"}`;
                const confirmation =
                  menuImport.status === "applied"
                    ? `Applied menu changes stay in place. The scan and its source images will be permanently removed after ${retentionLabel}.`
                    : `The scan and its source images will be permanently removed after ${retentionLabel}.`;

                return (
                  <li
                    key={menuImport.id}
                    className="rounded-2xl border border-zinc-200 bg-surface p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={statusTones[menuImport.status] ?? "neutral"}
                          >
                            {menuImport.status.replaceAll("_", " ")}
                          </Badge>
                          <Link
                            href={`/dashboard/restaurants/${restaurant.id}/imports/${menuImport.id}`}
                            className="text-sm font-medium text-zinc-800 hover:text-accent-strong hover:underline"
                          >
                            {menuTitle ?? "Draft menu removed"}
                          </Link>
                          {menuStatus ? (
                            <span className="text-xs capitalize text-zinc-400">
                              ({menuStatus})
                            </span>
                          ) : null}
                        </div>
                        {errorMessage ? (
                          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                            {errorMessage}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-zinc-500">
                            Open to review extracted items and apply accepted
                            changes to the draft.
                          </p>
                        )}
                        <Link
                          href={`/dashboard/restaurants/${restaurant.id}/imports/${menuImport.id}`}
                          className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                        >
                          Open scan
                        </Link>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-zinc-400">
                          {dateFormatter.format(menuImport.createdAt)}
                        </span>
                        {canDelete ? (
                          <form action={deleteImportAction}>
                            <input
                              type="hidden"
                              name="restaurantId"
                              value={restaurant.id}
                            />
                            <input
                              type="hidden"
                              name="importId"
                              value={menuImport.id}
                            />
                            <ConfirmButton
                              title="Delete this scan?"
                              message={confirmation}
                              confirmLabel="Delete scan"
                              pendingLabel="Deleting..."
                              className={buttonClass({
                                variant: "danger",
                                size: "sm",
                              })}
                            >
                              Delete
                            </ConfirmButton>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader
            icon={<ScanLine className="h-4 w-4 text-accent" aria-hidden="true" />}
            title="New scan"
            description={`Choose up to ${maxPages} page images. The draft menu is selected before upload.`}
          />
          <CardBody>
            {canEdit ? (
              <StartImportForm
                restaurantId={restaurant.id}
                menuOptions={draftMenus}
                storageConfigured={storageConfigured}
                maxPages={maxPages}
              />
            ) : (
              <Notice tone="warning">
                {restaurant.status !== "active"
                  ? "This restaurant is archived. Reactivate it before importing menus."
                  : "You need menu editing permission to import scans."}
              </Notice>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
