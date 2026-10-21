import type { Metadata } from "next";
import Link from "next/link";

import { RestaurantForm } from "@/components/restaurants/restaurant-form";
import { requireAdminUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "New restaurant",
  robots: { index: false, follow: false },
};

export default async function NewRestaurantPage() {
  await requireAdminUser();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/restaurants"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← Restaurants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          New restaurant
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Create the profile first. Menus and team access can be added after the
          restaurant exists.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <RestaurantForm mode="create" canEditSlug />
      </div>
    </div>
  );
}
