import type { Metadata } from "next";

import { RestaurantForm } from "@/components/restaurants/restaurant-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "New restaurant",
  robots: { index: false, follow: false },
};

export default async function NewRestaurantPage() {
  await requireAdminUser();

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/dashboard/restaurants"
        backLabel="Restaurants"
        title="New restaurant"
        description="Create the profile first. Menus and team access can be added after the restaurant exists."
      />

      <Card className="p-5 sm:p-6">
        <RestaurantForm mode="create" canEditSlug />
      </Card>
    </div>
  );
}
