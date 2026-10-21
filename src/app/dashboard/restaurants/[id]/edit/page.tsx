import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { RestaurantForm } from "@/components/restaurants/restaurant-form";
import { requireCurrentUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import { getRestaurantAccess } from "@/server/services/restaurant-access";

export const metadata: Metadata = {
  title: "Edit restaurant",
  robots: { index: false, follow: false },
};

export default async function EditRestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;

  let access;
  try {
    access = await getRestaurantAccess(getDb(), user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (!access.flags.canManageRestaurant) notFound();

  const { restaurant } = access;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/restaurants/${restaurant.id}`}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← {restaurant.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Edit restaurant details
        </h1>
      </div>

      {restaurant.status === "archived" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
          This restaurant is archived. An administrator must reactivate it
          before details can be edited.
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <RestaurantForm
            mode="edit"
            canEditSlug={access.actor.role === "admin"}
            values={{
              id: restaurant.id,
              name: restaurant.name,
              slug: restaurant.slug,
              description: restaurant.description,
              cuisineType: restaurant.cuisineType,
              address: restaurant.address,
              location: restaurant.location,
              contactPhone: restaurant.contactPhone,
              contactEmail: restaurant.contactEmail,
              operatingHours: restaurant.operatingHours,
            }}
          />
        </div>
      )}
    </div>
  );
}
