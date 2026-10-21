import type { Metadata } from "next";
import { MapPin, Plus, Store } from "lucide-react";
import Link from "next/link";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Restaurants
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
            {user.role === "admin"
              ? "Every restaurant in the directory. Create profiles, manage access, and keep public details current."
              : "Restaurants you can help manage, based on the access an administrator granted you."}
          </p>
        </div>
        {user.role === "admin" ? (
          <Link
            href="/dashboard/restaurants/new"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New restaurant
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <Store className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-zinc-900">
            {user.role === "admin"
              ? "No restaurants yet"
              : "No restaurant access yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
            {user.role === "admin"
              ? "Create the first restaurant profile to start adding menus and publishing prices."
              : "An administrator can grant you access to specific restaurants. Ask them to add you to the team."}
          </p>
          {user.role === "admin" ? (
            <Link
              href="/dashboard/restaurants/new"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create restaurant
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ restaurant, flags }) => (
            <Link
              key={restaurant.id}
              href={`/dashboard/restaurants/${restaurant.id}`}
              className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
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
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    restaurant.status === "active"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                      : "bg-zinc-100 text-zinc-600 ring-zinc-500/20"
                  }`}
                >
                  {restaurant.status}
                </span>
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
              ) : null}

              {user.role !== "admin" ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {flags.canManageRestaurant ? (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      Manage profile
                    </span>
                  ) : null}
                  {flags.canEditMenu ? (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      Edit menus
                    </span>
                  ) : null}
                  {flags.canPublishMenu ? (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      Publish menus
                    </span>
                  ) : null}
                  {!flags.canManageRestaurant &&
                  !flags.canEditMenu &&
                  !flags.canPublishMenu ? (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      View only
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
