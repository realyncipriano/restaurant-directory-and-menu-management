"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  createItemAction,
  deleteItemAction,
  updateItemAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

type VariantRow = { name: string; price: string };
type ModifierRow = { name: string; price: string; isAvailable: boolean };

function FieldError({ message }: { message?: string[] }) {
  if (!message?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{message[0]}</p>;
}

export type ItemFormValues = {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  basePrice: string;
  availabilityStatus: "available" | "unavailable";
  sortOrder: number;
  variants: VariantRow[];
  modifiers: ModifierRow[];
};

export function ItemForm({
  mode,
  restaurantId,
  menuId,
  categories,
  values,
  defaultCategoryId,
  defaultSortOrder = 0,
}: {
  mode: "create" | "edit";
  restaurantId: string;
  menuId: string;
  categories: { id: string; name: string }[];
  values?: ItemFormValues;
  defaultCategoryId?: string;
  defaultSortOrder?: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [variants, setVariants] = useState<VariantRow[]>(
    values?.variants ?? [],
  );
  const [modifiers, setModifiers] = useState<ModifierRow[]>(
    values?.modifiers ?? [],
  );
  const [state, formAction, pending] = useActionState(
    async (previous: FormState, formData: FormData): Promise<FormState> => {
      const result =
        mode === "create"
          ? await createItemAction(previous, formData)
          : await updateItemAction(previous, formData);
      if (mode === "create" && result.success) {
        formRef.current?.reset();
        setVariants([]);
        setModifiers([]);
      }
      return result;
    },
    EMPTY_FORM_STATE,
  );

  const categoryId = values?.categoryId ?? defaultCategoryId ?? "";

  return (
    <div className="space-y-3">
      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="menuId" value={menuId} />
        {values?.id ? <input type="hidden" name="itemId" value={values.id} /> : null}
        <input type="hidden" name="variants" value={JSON.stringify(variants)} />
        <input type="hidden" name="modifiers" value={JSON.stringify(modifiers)} />

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

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-zinc-600" htmlFor={`item-name-${values?.id ?? "new"}`}>
              Item name
            </label>
            <input
              id={`item-name-${values?.id ?? "new"}`}
              name="name"
              type="text"
              required
              defaultValue={values?.name ?? ""}
              className={inputClass}
              placeholder="Chicken Adobo"
            />
            <FieldError message={state.fieldErrors?.name} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600" htmlFor={`item-category-${values?.id ?? "new"}`}>
              Category
            </label>
            <select
              id={`item-category-${values?.id ?? "new"}`}
              name="categoryId"
              defaultValue={categoryId}
              className={inputClass}
              required
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.categoryId} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-600" htmlFor={`item-description-${values?.id ?? "new"}`}>
            Description
          </label>
          <textarea
            id={`item-description-${values?.id ?? "new"}`}
            name="description"
            rows={2}
            defaultValue={values?.description ?? ""}
            className={inputClass}
            placeholder="Ingredients, preparation, or serving notes"
          />
          <FieldError message={state.fieldErrors?.description} />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600" htmlFor={`item-price-${values?.id ?? "new"}`}>
              Base price (PHP)
            </label>
            <input
              id={`item-price-${values?.id ?? "new"}`}
              name="basePrice"
              type="text"
              inputMode="decimal"
              defaultValue={values?.basePrice ?? ""}
              className={inputClass}
              placeholder="185.00"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Leave blank if every serving has a variant price.
            </p>
            <FieldError message={state.fieldErrors?.basePrice} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600" htmlFor={`item-availability-${values?.id ?? "new"}`}>
              Availability
            </label>
            <select
              id={`item-availability-${values?.id ?? "new"}`}
              name="availabilityStatus"
              defaultValue={values?.availabilityStatus ?? "available"}
              className={inputClass}
            >
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <FieldError message={state.fieldErrors?.availabilityStatus} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600" htmlFor={`item-order-${values?.id ?? "new"}`}>
              Sort order
            </label>
            <input
              id={`item-order-${values?.id ?? "new"}`}
              name="sortOrder"
              type="number"
              min={0}
              step={1}
              defaultValue={values?.sortOrder ?? defaultSortOrder}
              className={inputClass}
            />
            <FieldError message={state.fieldErrors?.sortOrder} />
          </div>
        </div>

        <fieldset className="rounded-xl border border-zinc-200 p-3">
          <div className="flex items-center justify-between">
            <div>
              <legend className="text-xs font-semibold text-zinc-700">
                Variants
              </legend>
              <p className="text-[11px] text-zinc-500">
                Sizes or servings with their own price.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setVariants((rows) => [...rows, { name: "", price: "" }])
              }
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add variant
            </button>
          </div>

          {variants.length > 0 ? (
            <div className="mt-3 space-y-2">
              {variants.map((variant, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={variant.name}
                    onChange={(event) =>
                      setVariants((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, name: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className={inputClass}
                    placeholder="Regular"
                    aria-label={`Variant ${index + 1} name`}
                  />
                  <input
                    value={variant.price}
                    onChange={(event) =>
                      setVariants((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, price: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className={`${inputClass} sm:max-w-36`}
                    placeholder="185.00"
                    inputMode="decimal"
                    aria-label={`Variant ${index + 1} price`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setVariants((rows) =>
                        rows.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                    className="mt-1 rounded-lg px-2 text-zinc-400 hover:text-red-600"
                    aria-label={`Remove variant ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="rounded-xl border border-zinc-200 p-3">
          <div className="flex items-center justify-between">
            <div>
              <legend className="text-xs font-semibold text-zinc-700">
                Add-ons
              </legend>
              <p className="text-[11px] text-zinc-500">
                Optional extras with an additional price.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setModifiers((rows) => [
                  ...rows,
                  { name: "", price: "", isAvailable: true },
                ])
              }
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add add-on
            </button>
          </div>

          {modifiers.length > 0 ? (
            <div className="mt-3 space-y-2">
              {modifiers.map((modifier, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={modifier.name}
                    onChange={(event) =>
                      setModifiers((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, name: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className={inputClass}
                    placeholder="Extra rice"
                    aria-label={`Add-on ${index + 1} name`}
                  />
                  <input
                    value={modifier.price}
                    onChange={(event) =>
                      setModifiers((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, price: event.target.value }
                            : row,
                        ),
                      )
                    }
                    className={`${inputClass} sm:max-w-32`}
                    placeholder="25.00"
                    inputMode="decimal"
                    aria-label={`Add-on ${index + 1} price`}
                  />
                  <label className="flex items-center gap-1 text-[11px] text-zinc-600">
                    <input
                      type="checkbox"
                      checked={modifier.isAvailable}
                      onChange={(event) =>
                        setModifiers((rows) =>
                          rows.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, isAvailable: event.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                    Available
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setModifiers((rows) =>
                        rows.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                    className="rounded-lg px-2 text-zinc-400 hover:text-red-600"
                    aria-label={`Remove add-on ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Saving..."
            : mode === "create"
              ? "Add item"
              : "Save item"}
        </button>
      </form>

      {values?.id ? (
        <form action={deleteItemAction}>
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="menuId" value={menuId} />
          <input type="hidden" name="itemId" value={values.id} />
          <ConfirmButton
            message={`Remove “${values.name}” from this draft menu?`}
            className="text-xs font-medium text-red-600 hover:text-red-700"
          >
            Delete item
          </ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}
