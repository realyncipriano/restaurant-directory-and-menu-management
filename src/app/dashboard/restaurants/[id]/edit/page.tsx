import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RestaurantForm } from "@/components/restaurants/restaurant-form";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db/client";
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
      <PageHeader
        backHref={`/dashboard/restaurants/${restaurant.id}`}
        backLabel={restaurant.name}
        title="Edit restaurant details"
        description="These details appear on the public restaurant page. Changes are visible immediately after saving."
      />

      {restaurant.status === "archived" ? (
        <Notice tone="warning" title="This restaurant is archived">
          An administrator must reactivate it before details can be edited.
        </Notice>
      ) : (
        <Card className="p-5 sm:p-6">
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
        </Card>
      )}
    </div>
  );
}
