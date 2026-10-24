import {
  ArrowRight,
  CalendarClock,
  Mail,
  MapPin,
  Phone,
  UtensilsCrossed,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { SiteShell } from "@/components/public/site-shell";
import { getDb } from "@/db/client";
import { serializeJsonLd } from "@/lib/json-ld";
import { getPublicImageUrl } from "@/server/services/images";
import { getPublicRestaurant } from "@/server/services/public-directory";

export const instant = false;

const loadRestaurant = cache(async (slug: string) => {
  await connection();
  return getPublicRestaurant(getDb(), slug);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadRestaurant(slug);
  if (!data) {
    return { title: "Restaurant not found" };
  }

  const description =
    data.restaurant.description ??
    `View the current menus and prices at ${data.restaurant.name}.`;
  const coverUrl = getPublicImageUrl(data.restaurant.coverObjectKey);

  return {
    title: data.restaurant.name,
    description,
    openGraph: {
      title: data.restaurant.name,
      description,
      type: "website",
      images: coverUrl ? [coverUrl] : undefined,
    },
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
});

export default async function PublicRestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadRestaurant(slug);
  if (!data) notFound();

  const { restaurant, menus } = data;
  const coverUrl = getPublicImageUrl(restaurant.coverObjectKey);
  const logoUrl = getPublicImageUrl(restaurant.logoObjectKey);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    description: restaurant.description ?? undefined,
    servesCuisine: restaurant.cuisineType ?? undefined,
    image: coverUrl ?? logoUrl ?? undefined,
    telephone: restaurant.contactPhone ?? undefined,
    email: restaurant.contactEmail ?? undefined,
    address: restaurant.address ?? restaurant.location ?? undefined,
    hasMenu: menus.map((menu) => ({
      "@type": "Menu",
      name: menu.title,
      url: `/restaurants/${restaurant.slug}/menus/${menu.slug}`,
    })),
  };

  return (
    <SiteShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(jsonLd),
        }}
      />

      {coverUrl ? (
        <div className="h-44 w-full overflow-hidden bg-zinc-200 sm:h-64">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt={`${restaurant.name} cover`}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            ← All restaurants
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`${restaurant.name} logo`}
                className="h-16 w-16 rounded-xl object-cover ring-1 ring-zinc-200"
              />
            ) : null}
            <h1 className="font-serif text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
              {restaurant.name}
            </h1>
            {restaurant.cuisineType ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                {restaurant.cuisineType}
              </span>
            ) : null}
          </div>
          {restaurant.description ? (
            <p className="mt-3 max-w-3xl whitespace-pre-line text-base leading-7 text-zinc-600">
              {restaurant.description}
            </p>
          ) : null}

          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-zinc-600">
            {restaurant.address || restaurant.location ? (
              <div className="flex items-start gap-2">
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
                  aria-hidden="true"
                />
                <div>
                  <dt className="sr-only">Location</dt>
                  <dd>
                    {restaurant.address}
                    {restaurant.address && restaurant.location ? " · " : ""}
                    {restaurant.location}
                  </dd>
                </div>
              </div>
            ) : null}
            {restaurant.contactPhone ? (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                <dt className="sr-only">Phone</dt>
                <dd>
                  <a
                    href={`tel:${restaurant.contactPhone}`}
                    className="hover:underline"
                  >
                    {restaurant.contactPhone}
                  </a>
                </dd>
              </div>
            ) : null}
            {restaurant.contactEmail ? (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                <dt className="sr-only">Email</dt>
                <dd className="break-all">
                  <a
                    href={`mailto:${restaurant.contactEmail}`}
                    className="hover:underline"
                  >
                    {restaurant.contactEmail}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="text-lg font-semibold text-zinc-900">Menus</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Published by the restaurant. Prices are in Philippine pesos.
          </p>

          {menus.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
              <UtensilsCrossed
                className="mx-auto h-8 w-8 text-zinc-300"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium text-zinc-700">
                No menus published yet
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Check back soon or contact the restaurant for current prices.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {menus.map((menu) => (
                <Link
                  key={menu.id}
                  href={`/restaurants/${restaurant.slug}/menus/${menu.slug}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border border-zinc-200/90 bg-white p-5 transition hover:border-amber-300 hover:shadow-md"
                >
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 group-hover:text-amber-800">
                      {menu.title}
                    </h3>
                    {menu.description ? (
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">
                        {menu.description}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-zinc-500">
                      {menu.itemCount} item{menu.itemCount === 1 ? "" : "s"}
                      {menu.publishedAt
                        ? ` · Updated ${dateFormatter.format(menu.publishedAt)}`
                        : ""}
                    </p>
                  </div>
                  <ArrowRight
                    className="mt-1 h-4 w-4 shrink-0 text-zinc-400 group-hover:text-amber-700"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          {restaurant.operatingHours ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <CalendarClock className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                Operating hours
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-600">
                {restaurant.operatingHours}
              </p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600">
            <h2 className="text-sm font-semibold text-zinc-900">
              Before you visit
            </h2>
            <p className="mt-2">
              Menu availability and prices can change. Contact the restaurant
              directly to confirm details, especially for dine-in or large
              orders.
            </p>
          </section>
        </aside>
      </div>
    </SiteShell>
  );
}
