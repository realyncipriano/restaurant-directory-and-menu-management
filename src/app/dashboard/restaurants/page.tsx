import type { Metadata } from "next";
import { ArrowRight, MapPin, Plus, Store } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/guards";
import { listRestaurants } from "@/server/services/restaurants";

export const metadata: Metadata = {
  title: "Restaurants",
  robots: { index: false, follow: false },
};

export default async function RestaurantsPage() {
  const user = await requireCurrentUser();
  const rows = await listRestaurants(getDb(), user.id);
  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Restaurants"
        description={
          isAdmin
            ? "Every restaurant in the directory. Create profiles, manage access, and keep public details current."
            : "Restaurants you can help manage, based on the access an administrator granted you."
        }
        actions={
          isAdmin ? (
            <Link
              href="/dashboard/restaurants/new"
              className={buttonClass({ variant: "primary" })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New restaurant
            </Link>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Store className="h-6 w-6" aria-hidden="true" />}
          title={isAdmin ? "No restaurants yet" : "No restaurant access yet"}
          description={
            isAdmin
              ? "Create the first restaurant profile to start adding menus and publishing prices."
              : "An administrator can grant you access to specific restaurants. Ask them to add you to the team."
          }
          action={
            isAdmin ? (
              <Link
                href="/dashboard/restaurants/new"
                className={buttonClass({ variant: "secondary" })}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create restaurant
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ restaurant, flags }) => (
            <Link
              key={restaurant.id}
              href={`/dashboard/restaurants/${restaurant.id}`}
              className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-zinc-900 group-hover:text-amber-800">
                    {restaurant.name}
                  </h2>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                    /{restaurant.slug}
                  </p>
                </div>
                <Badge
                  tone={restaurant.status === "active" ? "success" : "neutral"}
                  className="shrink-0"
                >
                  {restaurant.status}
                </Badge>
              </div>

              {restaurant.location ? (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-zinc-600">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {restaurant.location}
                </p>
              ) : null}

              {restaurant.description ? (
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
                  {restaurant.description}
                </p>
              ) : (
                <p className="mt-2 text-sm italic text-zinc-400">
                  No description yet.
                </p>
              )}

              {!isAdmin ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {flags.canManageRestaurant ? (
                    <Badge tone="neutral">Manage profile</Badge>
                  ) : null}
                  {flags.canEditMenu ? <Badge tone="neutral">Edit menus</Badge> : null}
                  {flags.canPublishMenu ? (
                    <Badge tone="neutral">Publish menus</Badge>
                  ) : null}
                  {!flags.canManageRestaurant &&
                  !flags.canEditMenu &&
                  !flags.canPublishMenu ? (
                    <Badge tone="neutral">View only</Badge>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-4 flex items-center gap-1 border-t border-zinc-100 pt-3 text-xs font-medium text-amber-700">
                Open restaurant
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
