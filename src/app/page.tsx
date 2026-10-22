import {
  ArrowRight,
  MapPin,
  Search,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { SiteShell } from "@/components/public/site-shell";
import { getDb } from "@/db/client";
import { getPublicImageUrl } from "@/server/services/images";
import {
  listPublicCuisines,
  listPublicRestaurants,
} from "@/server/services/public-directory";

export const instant = false;

export const metadata: Metadata = {
  title: "Restaurant directory with menus and prices",
  description:
    "Browse local restaurants and their current menus, including variants and add-on prices in Philippine pesos.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    cuisine?: string | string[];
  }>;
}) {
  await connection();
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim() : "";
  const cuisine =
    typeof query.cuisine === "string" ? query.cuisine.trim() : "";

  const db = getDb();
  const [restaurants, cuisines] = await Promise.all([
    listPublicRestaurants(db, { search, cuisine }),
    listPublicCuisines(db),
  ]);

  const hasFilters = Boolean(search || cuisine);

  return (
    <SiteShell>
      <section className="border-b border-zinc-200 bg-[#f4efe5]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
              Restaurant directory
            </p>
            <h1 className="mt-3 max-w-2xl font-serif text-4xl font-medium leading-[1.08] tracking-tight text-zinc-900 sm:text-5xl">
              Know what is on the menu before you go.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
              Browse restaurants and their current menus, kept up to date by the
              people who run them. Prices are shown in Philippine pesos.
            </p>
          </div>

          <form
            action="/"
            method="get"
            className="mt-8 grid gap-3 rounded-xl border border-zinc-200 bg-white/80 p-3 shadow-sm sm:grid-cols-[1fr_14rem_auto]"
          >
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <label htmlFor="q" className="sr-only">
                Search restaurants
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={search}
                placeholder="Search by name, cuisine, or area"
                className="block w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-10 pr-3 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
              />
            </div>

            <div>
              <label htmlFor="cuisine" className="sr-only">
                Cuisine
              </label>
              <select
                id="cuisine"
                name="cuisine"
                defaultValue={cuisine}
                className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
              >
                <option value="">All cuisines</option>
                {cuisines.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800"
            >
              Search
            </button>
          </form>

          {hasFilters ? (
            <p className="mt-3 text-sm text-zinc-500">
              {restaurants.length} result{restaurants.length === 1 ? "" : "s"}
              {search ? ` for “${search}”` : ""}
              {cuisine ? ` in ${cuisine}` : ""}.{" "}
              <Link href="/" className="font-medium text-amber-700 hover:underline">
                Clear filters
              </Link>
            </p>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              {restaurants.length} restaurant
              {restaurants.length === 1 ? "" : "s"} with published information.
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {restaurants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Store className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-zinc-900">
              {hasFilters ? "No restaurants match those filters" : "No restaurants listed yet"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
              {hasFilters
                ? "Try a different search term or cuisine, or clear the filters."
                : "Restaurants will appear here once their profiles and menus are published."}
            </p>
            {hasFilters ? (
              <Link
                href="/"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {restaurants.map(({ restaurant, publishedMenuCount }) => {
              const coverUrl = getPublicImageUrl(restaurant.coverObjectKey);

              return (
                <Link
                  key={restaurant.id}
                  href={`/restaurants/${restaurant.slug}`}
                  className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white transition hover:border-amber-300 hover:shadow-md"
                >
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt=""
                      className="h-44 w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-serif text-xl font-medium leading-snug text-zinc-900 group-hover:text-amber-800">
                        {restaurant.name}
                      </h2>
                      <UtensilsCrossed
                        className="mt-1 h-4 w-4 shrink-0 text-amber-700"
                        aria-hidden="true"
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      {restaurant.cuisineType ? (
                        <span>{restaurant.cuisineType}</span>
                      ) : null}
                      {restaurant.location ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden="true" />
                          {restaurant.location}
                        </span>
                      ) : null}
                    </div>

                    {restaurant.description ? (
                      <p className="mt-3 line-clamp-3 flex-1 text-sm leading-6 text-zinc-600">
                        {restaurant.description}
                      </p>
                    ) : (
                      <div className="flex-1" />
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs">
                      <span className="text-zinc-500">
                        {publishedMenuCount === 0
                          ? "Menu coming soon"
                          : `${publishedMenuCount} published menu${publishedMenuCount === 1 ? "" : "s"}`}
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                        View
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </SiteShell>
  );
}
