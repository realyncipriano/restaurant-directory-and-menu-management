import type { Metadata } from "next";
import {
  ArrowRight,
  CalendarClock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import {
  activateRestaurantAction,
  archiveRestaurantAction,
  removeRestaurantImageAction,
  uploadRestaurantImageAction,
} from "@/app/dashboard/restaurants/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { ImageUploadForm } from "@/components/images/image-upload-form";
import { requireCurrentUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import {
  getPublicImageUrl,
  isImageStorageConfigured,
} from "@/server/services/images";
import { getRestaurantDetail } from "@/server/services/restaurants";

export const metadata: Metadata = {
  title: "Restaurant",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function RestaurantDetailPage({
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
  try {
    detail = await getRestaurantDetail(getDb(), user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { restaurant, flags, actor, accessCount } = detail;
  const isAdmin = actor.role === "admin";
  const imageStorageConfigured = isImageStorageConfigured();
  const logoUrl = getPublicImageUrl(restaurant.logoObjectKey);
  const coverUrl = getPublicImageUrl(restaurant.coverObjectKey);
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;

  const noticeMessage =
    notice === "updated"
      ? "Restaurant details saved."
      : notice === "archived"
        ? "Restaurant archived. It is hidden from the public directory."
        : notice === "activated"
          ? "Restaurant reactivated and visible to the public again."
          : notice === "image-removed"
            ? "Image removed."
            : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/dashboard/restaurants"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            ← Restaurants
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {restaurant.name}
            </h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                restaurant.status === "active"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                  : "bg-zinc-100 text-zinc-600 ring-zinc-500/20"
              }`}
            >
              {restaurant.status}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            /{restaurant.slug}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {flags.canManageRestaurant && restaurant.status === "active" ? (
            <Link
              href={`/dashboard/restaurants/${restaurant.id}/edit`}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit details
            </Link>
          ) : null}
          {isAdmin ? (
            <Link
              href={`/dashboard/restaurants/${restaurant.id}/access`}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Manage access
            </Link>
          ) : null}
        </div>
      </div>

      {noticeMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {noticeMessage}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          The action could not be completed. Please try again.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-zinc-900">Public profile</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-600">
              {restaurant.description || "No description yet."}
            </p>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Cuisine
                </dt>
                <dd className="mt-0.5 text-zinc-900">
                  {restaurant.cuisineType || "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Currency
                </dt>
                <dd className="mt-0.5 text-zinc-900">{restaurant.currency}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Location
                </dt>
                <dd className="mt-0.5 flex items-start gap-1.5 text-zinc-900">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                  <span>
                    {restaurant.address || "No address set"}
                    {restaurant.location ? ` · ${restaurant.location}` : ""}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Phone
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-zinc-900">
                  <Phone className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  {restaurant.contactPhone ? (
                    <a
                      href={`tel:${restaurant.contactPhone}`}
                      className="hover:underline"
                    >
                      {restaurant.contactPhone}
                    </a>
                  ) : (
                    "Not set"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Email
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 break-all text-zinc-900">
                  <Mail className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                  {restaurant.contactEmail ? (
                    <a
                      href={`mailto:${restaurant.contactEmail}`}
                      className="hover:underline"
                    >
                      {restaurant.contactEmail}
                    </a>
                  ) : (
                    "Not set"
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-900">Menus</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Draft, publish, and compare menu versions. Published menus appear
              on the public restaurant page.
            </p>
            <Link
              href={`/dashboard/restaurants/${restaurant.id}/menus`}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-800"
            >
              Manage menus
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-zinc-900">
              Operating hours
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-600">
              {restaurant.operatingHours || "Not set"}
            </p>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Updated {dateFormatter.format(restaurant.updatedAt)}
            </p>
          </section>

          {flags.canManageRestaurant && restaurant.status === "active" ? (
            <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5">
              <ImageUploadForm
                action={uploadRestaurantImageAction}
                removeAction={removeRestaurantImageAction}
                hidden={{
                  restaurantId: restaurant.id,
                  kind: "cover",
                }}
                currentUrl={coverUrl}
                label="Cover image"
                description="Wide image shown at the top of the public restaurant page."
                configured={imageStorageConfigured}
                removeLabel="Remove cover"
              />
              <div className="border-t border-zinc-100 pt-5">
                <ImageUploadForm
                  action={uploadRestaurantImageAction}
                  removeAction={removeRestaurantImageAction}
                  hidden={{
                    restaurantId: restaurant.id,
                    kind: "logo",
                  }}
                  currentUrl={logoUrl}
                  label="Logo"
                  description="Square logo shown alongside the restaurant name."
                  configured={imageStorageConfigured}
                  removeLabel="Remove logo"
                />
              </div>
            </section>
          ) : logoUrl || coverUrl ? (
            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-zinc-900">Images</h2>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt={`${restaurant.name} cover`}
                  className="h-32 w-full rounded-xl object-cover"
                />
              ) : null}
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={`${restaurant.name} logo`}
                  className="h-16 w-16 rounded-xl object-cover"
                />
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-zinc-900">
              Your access
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-zinc-600">
              <li>{flags.canManageRestaurant ? "✓" : "—"} Manage profile</li>
              <li>{flags.canEditMenu ? "✓" : "—"} Edit menus</li>
              <li>{flags.canPublishMenu ? "✓" : "—"} Publish menus</li>
            </ul>
            {isAdmin ? (
              <p className="mt-3 text-xs text-zinc-500">
                Administrators always have full access.
              </p>
            ) : null}
          </section>

          {isAdmin ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-zinc-900">
                Team access
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {accessCount} team member{accessCount === 1 ? "" : "s"} can view
                this restaurant.
              </p>
              <Link
                href={`/dashboard/restaurants/${restaurant.id}/access`}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-800"
              >
                Manage access
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </section>
          ) : null}

          {isAdmin ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-zinc-900">
                Lifecycle
              </h2>
              {restaurant.status === "active" ? (
                <>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Archiving hides the restaurant and its menus from the public
                    directory. No data is deleted.
                  </p>
                  <form action={archiveRestaurantAction} className="mt-3">
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={restaurant.id}
                    />
                    <ConfirmButton
                      message="Archive this restaurant? It will be hidden from the public directory."
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Archive restaurant
                    </ConfirmButton>
                  </form>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    This restaurant is archived and hidden from the public
                    directory. Reactivating restores its published content.
                  </p>
                  <form action={activateRestaurantAction} className="mt-3">
                    <input
                      type="hidden"
                      name="restaurantId"
                      value={restaurant.id}
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
                    >
                      Reactivate restaurant
                    </button>
                  </form>
                </>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
