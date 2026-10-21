"use client";

import { useActionState } from "react";

import {
  createRestaurantAction,
  updateRestaurantAction,
} from "@/app/dashboard/restaurants/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

export type RestaurantFormValues = {
  id?: string;
  name?: string;
  slug?: string;
  description?: string | null;
  cuisineType?: string | null;
  address?: string | null;
  location?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  operatingHours?: string | null;
};

function FieldError({ message }: { message?: string[] }) {
  if (!message?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{message[0]}</p>;
}

export function RestaurantForm({
  mode,
  values = {},
  canEditSlug,
}: {
  mode: "create" | "edit";
  values?: RestaurantFormValues;
  canEditSlug: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createRestaurantAction : updateRestaurantAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      {values.id ? (
        <input type="hidden" name="restaurantId" value={values.id} />
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Restaurant name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={values.name ?? ""}
            className={inputClass}
            placeholder="Lola Maria's Kitchen"
          />
          <FieldError message={state.fieldErrors?.name} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="slug" className="block text-sm font-medium text-zinc-700">
            URL slug
          </label>
          {canEditSlug ? (
            <>
              <input
                id="slug"
                name="slug"
                type="text"
                defaultValue={values.slug ?? ""}
                className={inputClass}
                placeholder="lola-marias-kitchen"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Lowercase letters, numbers, and hyphens. Leave blank to generate
                from the name. Changing it changes the public URL.
              </p>
              <FieldError message={state.fieldErrors?.slug} />
            </>
          ) : (
            <>
              <p className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-sm text-zinc-600">
                {values.slug}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Only administrators can change the public URL.
              </p>
            </>
          )}
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor="description"
            className="block text-sm font-medium text-zinc-700"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={values.description ?? ""}
            className={inputClass}
            placeholder="A short introduction shown on the public restaurant page."
          />
          <FieldError message={state.fieldErrors?.description} />
        </div>

        <div>
          <label
            htmlFor="cuisineType"
            className="block text-sm font-medium text-zinc-700"
          >
            Cuisine
          </label>
          <input
            id="cuisineType"
            name="cuisineType"
            type="text"
            defaultValue={values.cuisineType ?? ""}
            className={inputClass}
            placeholder="Filipino"
          />
          <FieldError message={state.fieldErrors?.cuisineType} />
        </div>

        <div>
          <label
            htmlFor="location"
            className="block text-sm font-medium text-zinc-700"
          >
            Area or city
          </label>
          <input
            id="location"
            name="location"
            type="text"
            defaultValue={values.location ?? ""}
            className={inputClass}
            placeholder="Makati City"
          />
          <FieldError message={state.fieldErrors?.location} />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor="address"
            className="block text-sm font-medium text-zinc-700"
          >
            Address
          </label>
          <input
            id="address"
            name="address"
            type="text"
            defaultValue={values.address ?? ""}
            className={inputClass}
            placeholder="123 Ayala Avenue, Makati City"
          />
          <FieldError message={state.fieldErrors?.address} />
        </div>

        <div>
          <label
            htmlFor="contactPhone"
            className="block text-sm font-medium text-zinc-700"
          >
            Contact phone
          </label>
          <input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            defaultValue={values.contactPhone ?? ""}
            className={inputClass}
            placeholder="+63 2 8123 4567"
          />
          <FieldError message={state.fieldErrors?.contactPhone} />
        </div>

        <div>
          <label
            htmlFor="contactEmail"
            className="block text-sm font-medium text-zinc-700"
          >
            Contact email
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={values.contactEmail ?? ""}
            className={inputClass}
            placeholder="hello@restaurant.ph"
          />
          <FieldError message={state.fieldErrors?.contactEmail} />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor="operatingHours"
            className="block text-sm font-medium text-zinc-700"
          >
            Operating hours
          </label>
          <textarea
            id="operatingHours"
            name="operatingHours"
            rows={3}
            defaultValue={values.operatingHours ?? ""}
            className={inputClass}
            placeholder={"Mon–Fri: 10:00 AM – 9:00 PM\nSat–Sun: 9:00 AM – 10:00 PM"}
          />
          <FieldError message={state.fieldErrors?.operatingHours} />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-100 pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Saving..."
            : mode === "create"
              ? "Create restaurant"
              : "Save changes"}
        </button>
        <p className="text-xs text-zinc-500">
          Currency is fixed to Philippine pesos (PHP).
        </p>
      </div>
    </form>
  );
}
