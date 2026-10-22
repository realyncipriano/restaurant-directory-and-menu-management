import type { Metadata } from "next";
import { ArrowRight, BookOpen, FilePenLine, Plus, ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { MenuForm } from "@/components/menus/menu-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}`}
        backLabel={restaurant.name}
        title="Menus"
        description="Published menus are live and read-only. Make changes in a draft, then publish to replace the current version."
        actions={
          <Link
            href={`/dashboard/restaurants/${restaurant.id}/imports`}
            className={buttonClass({ variant: "outline" })}
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            Scan a menu
          </Link>
        }
      />

      {notice ? (
        <Notice tone="success">
          {notice === "discarded"
            ? "Draft discarded. The published menu was left unchanged."
            : "Change saved."}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error">
          The action could not be completed. Please try again.
        </Notice>
      ) : null}

      {restaurant.status !== "active" ? (
        <Notice tone="warning" title="Restaurant archived">
          Menus cannot be edited or published until it is reactivated.
        </Notice>
      ) : null}

      {menus.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
          title="No menus yet"
          description="Create a draft menu, add categories and items, then publish it to the public restaurant page."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {menus.map((menu) => {
            const target = menu.draft ?? menu.published;
            if (!target) return null;
            return (
              <Link
                key={menu.lineageId}
                href={`/dashboard/restaurants/${restaurant.id}/menus/${target.id}`}
                className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
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
                  <Badge
                    tone={menu.draft ? "warning" : "success"}
                    className="shrink-0"
                  >
                    {menu.draft ? "draft" : "published"}
                  </Badge>
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

                <p className="mt-4 flex items-center gap-1 border-t border-zinc-100 pt-3 text-xs text-zinc-400">
                  Updated {dateFormatter.format(menu.updatedAt)}
                  <ArrowRight
                    className="ml-auto h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:text-amber-700"
                    aria-hidden="true"
                  />
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <details className="group rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </span>
            Create another menu
            <span className="ml-auto text-xs font-normal text-zinc-400">
              Draft first, publish later
            </span>
          </summary>
          <div className="border-t border-zinc-100 px-5 py-5">
            <MenuForm mode="create" restaurantId={restaurant.id} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
