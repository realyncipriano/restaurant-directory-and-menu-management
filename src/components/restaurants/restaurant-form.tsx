"use client";

import { useActionState } from "react";

import {
  createRestaurantAction,
  updateRestaurantAction,
} from "@/app/dashboard/restaurants/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

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

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  );
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
    <form action={formAction} className="space-y-7">
      {values.id ? (
        <input type="hidden" name="restaurantId" value={values.id} />
      ) : null}

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <section className="space-y-5">
        <SectionHeading
          title="Basic details"
          description="The essentials visitors see in the directory and on the restaurant page."
        />

        <Field
          id="name"
          label="Restaurant name"
          note="Shown as the title in the public directory and on every menu page."
          required
          error={state.fieldErrors?.name?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              type="text"
              defaultValue={values.name ?? ""}
              placeholder="Lola Maria's Kitchen"
            />
          )}
        </Field>

        <Field
          id="slug"
          label="URL slug"
          note={
            canEditSlug
              ? "Lowercase letters, numbers, and hyphens. Leave blank to generate from the name. Changing it changes the public URL."
              : "Only administrators can change the public URL."
          }
          error={state.fieldErrors?.slug?.[0]}
        >
          {(control) =>
            canEditSlug ? (
              <Input
                {...control}
                name="slug"
                type="text"
                defaultValue={values.slug ?? ""}
                placeholder="lola-marias-kitchen"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              />
            ) : (
              <p
                id={control.id}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-sm text-zinc-600"
              >
                /{values.slug}
              </p>
            )
          }
        </Field>

        <Field
          id="description"
          label="Description"
          note="A short introduction shown on the public restaurant page. Two or three sentences works best."
          error={state.fieldErrors?.description?.[0]}
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              rows={4}
              defaultValue={values.description ?? ""}
              placeholder="A short introduction shown on the public restaurant page."
            />
          )}
        </Field>

        <Field
          id="cuisineType"
          label="Cuisine"
          note="Used for directory filters and shown as a label, e.g. Filipino, Italian, or Café."
          error={state.fieldErrors?.cuisineType?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="cuisineType"
              type="text"
              defaultValue={values.cuisineType ?? ""}
              placeholder="Filipino"
            />
          )}
        </Field>
      </section>

      <div className="border-t border-zinc-100" />

      <section className="space-y-5">
        <SectionHeading
          title="Location"
          description="Help guests find the restaurant and understand which area it serves."
        />

        <Field
          id="location"
          label="Area or city"
          note="A short label shown on listing cards, such as the city or neighbourhood."
          error={state.fieldErrors?.location?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="location"
              type="text"
              defaultValue={values.location ?? ""}
              placeholder="Makati City"
            />
          )}
        </Field>

        <Field
          id="address"
          label="Address"
          note="Full street address shown on the public restaurant page."
          error={state.fieldErrors?.address?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="address"
              type="text"
              defaultValue={values.address ?? ""}
              placeholder="123 Ayala Avenue, Makati City"
            />
          )}
        </Field>
      </section>

      <div className="border-t border-zinc-100" />

      <section className="space-y-5">
        <SectionHeading
          title="Contact and hours"
          description="Optional details visitors can use to reach the restaurant or plan a visit."
        />

        <Field
          id="contactPhone"
          label="Contact phone"
          note="Shown publicly so guests can call ahead. Include the area code."
          error={state.fieldErrors?.contactPhone?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="contactPhone"
              type="tel"
              defaultValue={values.contactPhone ?? ""}
              placeholder="+63 2 8123 4567"
            />
          )}
        </Field>

        <Field
          id="contactEmail"
          label="Contact email"
          note="Shown publicly for enquiries about this listing."
          error={state.fieldErrors?.contactEmail?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="contactEmail"
              type="email"
              defaultValue={values.contactEmail ?? ""}
              placeholder="hello@restaurant.ph"
            />
          )}
        </Field>

        <Field
          id="operatingHours"
          label="Operating hours"
          note="Use one line per schedule. Example: Mon–Fri: 10:00 AM – 9:00 PM."
          error={state.fieldErrors?.operatingHours?.[0]}
        >
          {(control) => (
            <Textarea
              {...control}
              name="operatingHours"
              rows={3}
              defaultValue={values.operatingHours ?? ""}
              placeholder={"Mon–Fri: 10:00 AM – 9:00 PM\nSat–Sun: 9:00 AM – 10:00 PM"}
            />
          )}
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-5">
        <Button type="submit" isLoading={pending} loadingLabel="Saving...">
          {mode === "create" ? "Create restaurant" : "Save changes"}
        </Button>
        <p className="text-xs text-zinc-500">
          Currency is fixed to Philippine pesos (PHP).
        </p>
      </div>
    </form>
  );
}
