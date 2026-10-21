import type { Metadata } from "next";
import { ArrowRight, BookOpen, FilePenLine, Plus, ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { MenuForm } from "@/components/menus/menu-form";
import { requireCurrentUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import { listMenusForRestaurant } from "@/server/services/menus";
import { getRestaurantDetail } from "@/server/services/restaurants";

export const metadata: Metadata = {
  title: "Menus",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function RestaurantMenusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const query = await searchParams;

  let detail;
  let menus;
  try {
    detail = await getRestaurantDetail(getDb(), user.id, id);
    menus = await listMenusForRestaurant(getDb(), user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { restaurant, flags } = detail;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const canEdit = flags.canEditMenu && restaurant.status === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href={`/dashboard/restaurants/${restaurant.id}`}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            ← {restaurant.name}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            Menus
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
            Published menus are live and read-only. Make changes in a draft, then
            publish to replace the current version.
          </p>
        </div>
        <Link
          href={`/dashboard/restaurants/${restaurant.id}/imports`}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          Scan a menu
        </Link>
      </div>

      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice === "discarded"
            ? "Draft discarded. The published menu was left unchanged."
            : "Change saved."}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          The action could not be completed. Please try again.
        </p>
      ) : null}

      {restaurant.status !== "active" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This restaurant is archived. Menus cannot be edited or published until
          it is reactivated.
        </p>
      ) : null}

      {menus.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-zinc-900">
            No menus yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
            Create a draft menu, add categories and items, then publish it to the
            public restaurant page.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {menus.map((menu) => {
            const target = menu.draft ?? menu.published;
            if (!target) return null;
            return (
              <Link
                key={menu.lineageId}
                href={`/dashboard/restaurants/${restaurant.id}/menus/${target.id}`}
                className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-zinc-900 group-hover:text-amber-800">
                      {menu.title}
                    </h2>
                    <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      /{target.slug}
                    </p>
                  </div>
                  {menu.draft ? (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                      draft
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      published
                    </span>
                  )}
                </div>

                <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
                  {menu.published ? (
                    <div>
                      <dt className="inline">Published: </dt>
                      <dd className="inline">
                        v{menu.published.version} · {menu.publishedItemCount} items
                      </dd>
                    </div>
                  ) : (
                    <div>
                      <dt className="inline">Published: </dt>
                      <dd className="inline">Not yet</dd>
                    </div>
                  )}
                  {menu.draft ? (
                    <div className="flex items-center gap-1 font-medium text-amber-700">
                      <FilePenLine className="h-3.5 w-3.5" aria-hidden="true" />
                      <dt className="sr-only">Draft</dt>
                      <dd>
                        Draft v{menu.draft.version} · {menu.draftItemCount} items
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <p className="mt-3 flex items-center gap-1 text-xs text-zinc-400">
                  Updated {dateFormatter.format(menu.updatedAt)}
                  <ArrowRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <details className="rounded-2xl border border-zinc-200 bg-white p-5">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-900">
            <Plus className="h-4 w-4 text-amber-700" aria-hidden="true" />
            Create another menu
          </summary>
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <MenuForm mode="create" restaurantId={restaurant.id} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
