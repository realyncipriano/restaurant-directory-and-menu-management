import { ArrowUp, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { SiteShell } from "@/components/public/site-shell";
import { getDb } from "@/db/client";
import { formatPrice } from "@/lib/money";
import { getPublicImageUrl } from "@/server/services/images";
import { getPublicMenu } from "@/server/services/public-directory";

export const instant = false;

const loadMenu = cache(
  async (restaurantSlug: string, menuSlug: string) => {
    await connection();
    return getPublicMenu(getDb(), restaurantSlug, menuSlug);
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; menuSlug: string }>;
}): Promise<Metadata> {
  const { slug, menuSlug } = await params;
  const data = await loadMenu(slug, menuSlug);
  if (!data) return { title: "Menu not found" };

  const title = `${data.tree.menu.title} · ${data.restaurant.name}`;
  const description =
    data.tree.menu.description ??
    `Current menu and prices at ${data.restaurant.name}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
});

export default async function PublicMenuPage({
  params,
}: {
  params: Promise<{ slug: string; menuSlug: string }>;
}) {
  const { slug, menuSlug } = await params;
  const data = await loadMenu(slug, menuSlug);
  if (!data) notFound();

  const { restaurant, tree } = data;
  const { menu, categories } = tree;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Menu",
    name: menu.title,
    description: menu.description ?? undefined,
    inLanguage: "en-PH",
    dateModified: menu.publishedAt?.toISOString(),
    hasMenuSection: categories.map((category) => ({
      "@type": "MenuSection",
      name: category.name,
      description: category.description ?? undefined,
      hasMenuItem: category.items.map((item) => ({
        "@type": "MenuItem",
        name: item.name,
        description: item.description ?? undefined,
        offers:
          item.basePriceMinor !== null
            ? {
                "@type": "Offer",
                price: item.basePriceMinor / 100,
                priceCurrency: item.currency,
              }
            : undefined,
      })),
    })),
  };

  return (
    <SiteShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <div id="top" className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
          <nav className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-500">
            <Link href="/" className="hover:text-zinc-800">
              Restaurants
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              href={`/restaurants/${restaurant.slug}`}
              className="hover:text-zinc-800"
            >
              {restaurant.name}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-zinc-700">{menu.title}</span>
          </nav>

          <div className="mt-3 flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-serif text-3xl font-medium tracking-tight text-zinc-900">
                {menu.title}
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                {restaurant.name}
                {menu.publishedAt
                  ? ` · Updated ${dateFormatter.format(menu.publishedAt)}`
                  : ""}
              </p>
            </div>
          </div>

          {menu.description ? (
            <p className="mt-4 max-w-2xl whitespace-pre-line text-base leading-7 text-zinc-600">
              {menu.description}
            </p>
          ) : null}

          {restaurant.address || restaurant.location ? (
            <p className="mt-3 text-sm text-zinc-500">
              {restaurant.address}
              {restaurant.address && restaurant.location ? " · " : ""}
              {restaurant.location}
            </p>
          ) : null}
        </div>
      </div>

      {categories.length > 1 ? (
        <nav
          aria-label="Menu categories"
          className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/95 backdrop-blur"
        >
          <div className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4 py-2 sm:px-6 [scrollbar-width:none]">
            {categories.map((category) => (
              <a
                key={category.id}
                href={`#category-${category.id}`}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-white hover:text-zinc-900 hover:ring-1 hover:ring-zinc-200"
              >
                {category.name}
              </a>
            ))}
          </div>
        </nav>
      ) : null}

      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {categories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-sm text-zinc-500">
            This menu does not have any categories yet.
          </div>
        ) : (
          <div className="space-y-10">
            {categories.map((category) => (
              <section
                key={category.id}
                id={`category-${category.id}`}
                className="scroll-mt-20"
              >
                <div className="border-b border-zinc-200 pb-3">
                  <h2 className="font-serif text-2xl font-medium tracking-tight text-zinc-900">
                    {category.name}
                  </h2>
                  {category.description ? (
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      {category.description}
                    </p>
                  ) : null}
                </div>

                <ul className="divide-y divide-zinc-100">
                  {category.items.map((item) => (
                    <li key={item.id} className="py-5">
                      <div className="flex items-start justify-between gap-6">
                        {getPublicImageUrl(item.imageObjectKey) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={
                              getPublicImageUrl(item.imageObjectKey) ?? ""
                            }
                            alt={item.name}
                            className="hidden h-24 w-24 shrink-0 rounded-xl object-cover sm:block"
                            loading="lazy"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <h3 className="text-base font-medium text-zinc-900">
                            {item.name}
                            {item.availabilityStatus === "unavailable" ? (
                              <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                                Currently unavailable
                              </span>
                            ) : null}
                          </h3>
                          {item.description ? (
                            <p className="mt-1 text-sm leading-6 text-zinc-600">
                              {item.description}
                            </p>
                          ) : null}

                          {item.variants.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                              {item.variants.map((variant) => (
                                <li
                                  key={variant.id}
                                  className="flex justify-between gap-4 sm:max-w-sm"
                                >
                                  <span>{variant.name}</span>
                                  <span className="font-medium text-zinc-900">
                                    {formatPrice(
                                      variant.priceMinor,
                                      item.currency,
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {item.modifiers.length > 0 ? (
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              Add-ons:{" "}
                              {item.modifiers
                                .map(
                                  (modifier) =>
                                    `${modifier.name} +${formatPrice(
                                      modifier.additionalPriceMinor,
                                      item.currency,
                                    )}${modifier.isAvailable ? "" : " (unavailable)"}`,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>

                        <p className="shrink-0 text-base font-semibold text-zinc-900">
                          {item.basePriceMinor !== null
                            ? formatPrice(item.basePriceMinor, item.currency)
                            : item.variants.length > 0
                              ? "Varies"
                              : "Price not listed"}
                        </p>
                      </div>
                    </li>
                  ))}
                  {category.items.length === 0 ? (
                    <li className="py-5 text-sm text-zinc-500">
                      No items listed in this category.
                    </li>
                  ) : null}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="mt-12 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs leading-5 text-zinc-500">
          Prices and availability are supplied by the restaurant and may change.
          Confirm details with {restaurant.name} before ordering.
        </p>

        <div className="mt-6 text-center">
          <a
            href="#top"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            Back to top
          </a>
        </div>
      </div>
    </SiteShell>
  );
}
