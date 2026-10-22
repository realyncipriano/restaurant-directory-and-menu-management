"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  createItemAction,
  deleteItemAction,
  updateItemAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/action-state";

type VariantRow = { name: string; price: string };
type ModifierRow = { name: string; price: string; isAvailable: boolean };

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

function SectionHint({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-xs font-semibold text-zinc-800">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

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
  const key = values?.id ?? "new";

  return (
    <div className="space-y-3">
      <form ref={formRef} action={formAction} className="space-y-5">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="menuId" value={menuId} />
        {values?.id ? <input type="hidden" name="itemId" value={values.id} /> : null}
        <input type="hidden" name="variants" value={JSON.stringify(variants)} />
        <input type="hidden" name="modifiers" value={JSON.stringify(modifiers)} />

        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state.success ? <Notice tone="success">{state.success}</Notice> : null}

        <Field
          id={`item-name-${key}`}
          label="Item name"
          note="Shown as the dish name on the public menu."
          required
          error={state.fieldErrors?.name?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              type="text"
              defaultValue={values?.name ?? ""}
              placeholder="Chicken Adobo"
            />
          )}
        </Field>

        <Field
          id={`item-category-${key}`}
          label="Category"
          note="Choose which menu section this item belongs to."
          required
          error={state.fieldErrors?.categoryId?.[0]}
        >
          {(control) => (
            <Select {...control} name="categoryId" defaultValue={categoryId}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id={`item-description-${key}`}
          label="Description"
          note="Optional ingredients, preparation, or serving notes."
          optional
          error={state.fieldErrors?.description?.[0]}
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              rows={2}
              defaultValue={values?.description ?? ""}
              placeholder="Ingredients, preparation, or serving notes"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id={`item-price-${key}`}
            label="Base price (PHP)"
            note="Leave blank if every serving has a variant price."
            noteLayout="below"
            error={state.fieldErrors?.basePrice?.[0]}
          >
            {(control) => (
              <Input
                {...control}
                name="basePrice"
                type="text"
                inputMode="decimal"
                defaultValue={values?.basePrice ?? ""}
                placeholder="185.00"
              />
            )}
          </Field>

          <Field
            id={`item-availability-${key}`}
            label="Availability"
            note="Unavailable items stay listed but are marked to guests."
            noteLayout="below"
            error={state.fieldErrors?.availabilityStatus?.[0]}
          >
            {(control) => (
              <Select
                {...control}
                name="availabilityStatus"
                defaultValue={values?.availabilityStatus ?? "available"}
              >
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
              </Select>
            )}
          </Field>

          <Field
            id={`item-order-${key}`}
            label="Sort order"
            note="Lower numbers appear first within the category."
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
                defaultValue={values?.sortOrder ?? defaultSortOrder}
              />
            )}
          </Field>
        </div>

        <fieldset className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4">
          <SectionHint
            title="Variants"
            description="Sizes or servings with their own price, e.g. Regular and Large."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setVariants((rows) => [...rows, { name: "", price: "" }])
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add variant
              </Button>
            }
          />

          {variants.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_2rem]">
                <span>Name</span>
                <span>Price (PHP)</span>
                <span />
              </div>
              {variants.map((variant, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_2rem]"
                >
                  <Input
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
                    className="py-2"
                    placeholder="Regular"
                    aria-label={`Variant ${index + 1} name`}
                  />
                  <Input
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
                    className="col-start-1 py-2 sm:col-start-auto"
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
                    className="col-start-2 row-start-1 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 sm:col-start-auto sm:row-start-auto"
                    aria-label={`Remove variant ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">
              No variants yet. The base price will be used.
            </p>
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4">
          <SectionHint
            title="Add-ons"
            description="Optional extras with an additional price, e.g. Extra rice."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setModifiers((rows) => [
                    ...rows,
                    { name: "", price: "", isAvailable: true },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add add-on
              </Button>
            }
          />

          {modifiers.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_5rem_2rem]">
                <span>Name</span>
                <span>Extra price</span>
                <span>Available</span>
                <span />
              </div>
              {modifiers.map((modifier, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_2rem]"
                >
                  <Input
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
                    className="py-2"
                    placeholder="Extra rice"
                    aria-label={`Add-on ${index + 1} name`}
                  />
                  <Input
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
                    className="col-start-1 py-2 sm:col-start-auto"
                    placeholder="25.00"
                    inputMode="decimal"
                    aria-label={`Add-on ${index + 1} price`}
                  />
                  <label className="col-start-1 flex items-center gap-1.5 text-xs text-zinc-600 sm:col-start-auto">
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
                      className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-600/40"
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
                    className="col-start-2 row-start-1 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 sm:col-start-auto sm:row-start-auto"
                    aria-label={`Remove add-on ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">No add-ons yet.</p>
          )}
        </fieldset>

        <div className="border-t border-zinc-100 pt-4">
          <Button type="submit" isLoading={pending} loadingLabel="Saving...">
            {mode === "create" ? "Add item" : "Save item"}
          </Button>
        </div>
      </form>

      {values?.id ? (
        <form action={deleteItemAction} className="border-t border-zinc-100 pt-3">
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
