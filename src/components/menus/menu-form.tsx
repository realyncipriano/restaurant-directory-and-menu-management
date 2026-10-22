"use client";

import { useActionState } from "react";

import {
  createMenuAction,
  updateMenuSettingsAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function MenuForm({
  mode,
  restaurantId,
  menuId,
  values = {},
}: {
  mode: "create" | "edit";
  restaurantId: string;
  menuId?: string;
  values?: {
    title?: string;
    slug?: string;
    description?: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createMenuAction : updateMenuSettingsAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      {menuId ? <input type="hidden" name="menuId" value={menuId} /> : null}

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <Field
        id={`${mode}-title`}
        label="Menu title"
        note="Shown at the top of the public menu, e.g. Lunch Menu or Weekend Brunch."
        required
        error={state.fieldErrors?.title?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="title"
            type="text"
            defaultValue={values.title ?? ""}
            placeholder="Lunch Menu"
          />
        )}
      </Field>

      <Field
        id={`${mode}-slug`}
        label="URL slug"
        note="Leave blank to generate one from the title. Lowercase letters, numbers, and hyphens only."
        error={state.fieldErrors?.slug?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="slug"
            type="text"
            defaultValue={values.slug ?? ""}
            placeholder="lunch-menu"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          />
        )}
      </Field>

      <Field
        id={`${mode}-description`}
        label="Description"
        note="Optional short note shown under the menu title on the public page."
        error={state.fieldErrors?.description?.[0]}
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={3}
            defaultValue={values.description ?? ""}
            placeholder="What makes this menu special?"
          />
        )}
      </Field>

      <div className="border-t border-zinc-100 pt-5">
        <Button type="submit" isLoading={pending} loadingLabel="Saving...">
          {mode === "create" ? "Create draft menu" : "Save menu details"}
        </Button>
      </div>
    </form>
  );
}
