"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";
import { ConfirmButton } from "@/components/dashboard/confirm-button";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

function FieldError({ message }: { message?: string[] }) {
  if (!message?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{message[0]}</p>;
}

export function CategoryForm({
  mode,
  restaurantId,
  menuId,
  category,
  defaultSortOrder = 0,
}: {
  mode: "create" | "edit";
  restaurantId: string;
  menuId: string;
  category?: {
    id: string;
    name: string;
    description: string | null;
    sortOrder: number;
  };
  defaultSortOrder?: number;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createCategoryAction : updateCategoryAction,
    EMPTY_FORM_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (mode === "create" && state.success) {
      formRef.current?.reset();
    }
  }, [mode, state.success]);

  return (
    <div className="space-y-3">
      <form ref={formRef} action={formAction} className="space-y-3">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="menuId" value={menuId} />
        {category ? (
          <input type="hidden" name="categoryId" value={category.id} />
        ) : null}

        {state.error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.success}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <div>
            <label
              htmlFor={`category-name-${category?.id ?? "new"}`}
              className="block text-xs font-medium text-zinc-600"
            >
              Category name
            </label>
            <input
              id={`category-name-${category?.id ?? "new"}`}
              name="name"
              type="text"
              required
              defaultValue={category?.name ?? ""}
              className={inputClass}
              placeholder="Starters"
            />
            <FieldError message={state.fieldErrors?.name} />
          </div>
          <div>
            <label
              htmlFor={`category-order-${category?.id ?? "new"}`}
              className="block text-xs font-medium text-zinc-600"
            >
              Sort order
            </label>
            <input
              id={`category-order-${category?.id ?? "new"}`}
              name="sortOrder"
              type="number"
              min={0}
              step={1}
              defaultValue={category?.sortOrder ?? defaultSortOrder}
              className={inputClass}
            />
            <FieldError message={state.fieldErrors?.sortOrder} />
          </div>
        </div>

        <div>
          <label
            htmlFor={`category-description-${category?.id ?? "new"}`}
            className="block text-xs font-medium text-zinc-600"
          >
            Description
          </label>
          <input
            id={`category-description-${category?.id ?? "new"}`}
            name="description"
            type="text"
            defaultValue={category?.description ?? ""}
            className={inputClass}
            placeholder="Optional note shown under the category name"
          />
          <FieldError message={state.fieldErrors?.description} />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Saving..."
            : mode === "create"
              ? "Add category"
              : "Save category"}
        </button>
      </form>

      {category ? (
        <form action={deleteCategoryAction}>
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="menuId" value={menuId} />
          <input type="hidden" name="categoryId" value={category.id} />
          <ConfirmButton
            message={`Delete “${category.name}” and all of its items from this draft?`}
            className="text-xs font-medium text-red-600 hover:text-red-700"
          >
            Delete category
          </ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}
