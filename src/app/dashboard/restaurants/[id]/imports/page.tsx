import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { StartImportForm } from "@/components/imports/start-import-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
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
  searchParams: Promise<{ error?: string | string[] }>;
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
  const draftMenus = menus
    .filter((menu) => menu.draft)
    .map((menu) => ({ id: menu.draft?.id ?? "", title: menu.title }))
    .filter((menu) => menu.id);
  const storageConfigured = isPrivateStorageConfigured();
  const extractionConfigured = isExtractionConfigured();
  const maxPages = getExtractionConfig()?.maxPages ?? 10;
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}/menus`}
        backLabel="Menus"
        title="Menu scans"
        description="Upload menu photos, extract items into a review queue, and apply only the items you accept to a draft menu. Published menus are never changed directly."
      />

      {error ? (
        <Notice tone="error">
          The action could not be completed. Please try again.
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
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">Scan history</h2>
            <span className="text-xs text-zinc-500">
              {data.imports.length} scan{data.imports.length === 1 ? "" : "s"}
            </span>
          </div>

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
                return (
                  <li key={menuImport.id}>
                    <Link
                      href={`/dashboard/restaurants/${restaurant.id}/imports/${menuImport.id}`}
                      className="block rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={statusTones[menuImport.status] ?? "neutral"}
                        >
                          {menuImport.status.replaceAll("_", " ")}
                        </Badge>
                        <span className="text-sm font-medium text-zinc-800">
                          {menuTitle ?? "Draft menu removed"}
                        </span>
                        {menuStatus ? (
                          <span className="text-xs capitalize text-zinc-400">
                            ({menuStatus})
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-zinc-400">
                          {dateFormatter.format(menuImport.createdAt)}
                        </span>
                      </div>
                      {errorMessage ? (
                        <p className="mt-2 text-xs text-red-600">
                          {errorMessage}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">
                          Open to review extracted items and apply accepted
                          changes to the draft.
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader
            icon={<ScanLine className="h-4 w-4 text-amber-700" aria-hidden="true" />}
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
