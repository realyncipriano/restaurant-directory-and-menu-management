"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

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

  const key = category?.id ?? "new";

  return (
    <div className="space-y-3">
      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="menuId" value={menuId} />
        {category ? (
          <input type="hidden" name="categoryId" value={category.id} />
        ) : null}

        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state.success ? <Notice tone="success">{state.success}</Notice> : null}

        <Field
          id={`category-name-${key}`}
          label="Category name"
          note="Shown as a section heading on the public menu, e.g. Starters or Main dishes."
          noteLayout="below"
          required
          error={state.fieldErrors?.name?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              type="text"
              defaultValue={category?.name ?? ""}
              placeholder="Starters"
            />
          )}
        </Field>

        <Field
          id={`category-order-${key}`}
          label="Sort order"
          note="Lower numbers appear first. Use gaps like 10, 20, 30 to make room for new sections."
          noteLayout="below"
          error={state.fieldErrors?.sortOrder?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="sortOrder"
              type="number"
              min={0}
              step={1}
              defaultValue={category?.sortOrder ?? defaultSortOrder}
              className="sm:max-w-32"
            />
          )}
        </Field>

        <Field
          id={`category-description-${key}`}
          label="Description"
          note="Optional note shown under the category name."
          noteLayout="below"
          optional
          error={state.fieldErrors?.description?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="description"
              type="text"
              defaultValue={category?.description ?? ""}
              placeholder="Freshly prepared small plates"
            />
          )}
        </Field>

        <Button
          type="submit"
          variant="secondary"
          size="sm"
          isLoading={pending}
          loadingLabel="Saving..."
        >
          {mode === "create" ? "Add category" : "Save category"}
        </Button>
      </form>

      {category ? (
        <form action={deleteCategoryAction} className="border-t border-zinc-200 pt-3">
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
