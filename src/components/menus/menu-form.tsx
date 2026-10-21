"use client";

import { useActionState } from "react";

import {
  createMenuAction,
  updateMenuSettingsAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

function FieldError({ message }: { message?: string[] }) {
  if (!message?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{message[0]}</p>;
}

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
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      {menuId ? <input type="hidden" name="menuId" value={menuId} /> : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor={`${mode}-title`} className="block text-sm font-medium text-zinc-700">
          Menu title
        </label>
        <input
          id={`${mode}-title`}
          name="title"
          type="text"
          required
          defaultValue={values.title ?? ""}
          className={inputClass}
          placeholder="Lunch Menu"
        />
        <FieldError message={state.fieldErrors?.title} />
      </div>

      <div>
        <label htmlFor={`${mode}-slug`} className="block text-sm font-medium text-zinc-700">
          URL slug
        </label>
        <input
          id={`${mode}-slug`}
          name="slug"
          type="text"
          defaultValue={values.slug ?? ""}
          className={inputClass}
          placeholder="lunch-menu"
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Leave blank to generate one from the title. Lowercase letters, numbers,
          and hyphens only.
        </p>
        <FieldError message={state.fieldErrors?.slug} />
      </div>

      <div>
        <label htmlFor={`${mode}-description`} className="block text-sm font-medium text-zinc-700">
          Description
        </label>
        <textarea
          id={`${mode}-description`}
          name="description"
          rows={3}
          defaultValue={values.description ?? ""}
          className={inputClass}
          placeholder="What makes this menu special?"
        />
        <FieldError message={state.fieldErrors?.description} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? "Saving..."
          : mode === "create"
            ? "Create draft menu"
            : "Save menu details"}
      </button>
    </form>
  );
}
