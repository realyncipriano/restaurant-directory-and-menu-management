import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { StartImportForm } from "@/components/imports/start-import-form";
import { requireCurrentUser } from "@/lib/auth/guards";
import {
  getExtractionConfig,
  isExtractionConfigured,
} from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { listMenuImports } from "@/server/services/imports";
import { listMenusForRestaurant } from "@/server/services/menus";
import { getRestaurantDetail } from "@/server/services/restaurants";
import { isStorageConfigured } from "@/server/services/storage";

export const metadata: Metadata = {
  title: "Menu scans",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusStyles: Record<string, string> = {
  uploaded: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
  processing: "bg-sky-50 text-sky-700 ring-sky-600/20",
  needs_review: "bg-amber-50 text-amber-800 ring-amber-600/20",
  reviewed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  applied: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
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
  const storageConfigured = isStorageConfigured();
  const extractionConfigured = isExtractionConfigured();
  const maxPages = getExtractionConfig()?.maxPages ?? 10;
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/restaurants/${restaurant.id}/menus`}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← Menus
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Menu scans
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Upload menu photos, extract items into a review queue, and apply only
          the items you accept to a draft menu. Published menus are never
          changed directly.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          The action could not be completed. Please try again.
        </p>
      ) : null}

      {!extractionConfigured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Menu extraction is not configured. You can upload scans, but processing
          stays disabled until an extraction provider and API key are set. Manual
          menu entry remains available.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900">Scan history</h2>
          {data.imports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
              <ScanLine
                className="mx-auto h-7 w-7 text-amber-700"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-semibold text-zinc-900">
                No scans yet
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                Upload menu photos to start an import.
              </p>
            </div>
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
                      className="block rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-amber-300 hover:shadow"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${
                            statusStyles[menuImport.status] ??
                            statusStyles.uploaded
                          }`}
                        >
                          {menuImport.status.replaceAll("_", " ")}
                        </span>
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
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="h-fit rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <ScanLine className="h-4 w-4 text-amber-700" aria-hidden="true" />
            New scan
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Choose up to {maxPages} page images. The draft menu is selected before
            upload.
          </p>
          <div className="mt-4">
            {canEdit ? (
              <StartImportForm
                restaurantId={restaurant.id}
                menuOptions={draftMenus}
                storageConfigured={storageConfigured}
                maxPages={maxPages}
              />
            ) : (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                {restaurant.status !== "active"
                  ? "This restaurant is archived. Reactivate it before importing menus."
                  : "You need menu editing permission to import scans."}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
