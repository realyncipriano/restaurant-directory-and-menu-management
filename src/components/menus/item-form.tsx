"use client";

import { useActionState, useRef, useState } from "react";

import {
  createItemAction,
  deleteItemAction,
  updateItemAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { ModifiersEditor } from "@/components/menus/item-form/modifiers-editor";
import { VariantsEditor } from "@/components/menus/item-form/variants-editor";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/action-state";
import {
  addRow,
  createModifierRow,
  createVariantRow,
  removeRowAt,
  serializeModifierRows,
  serializeVariantRows,
  updateRow,
  type ModifierRow,
  type VariantRow,
} from "@/lib/menu-item-rows";

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
  const key = values?.id ?? "new";

  const handleAddVariant = () => {
    setVariants((rows) => addRow(rows, createVariantRow()));
  };
  const handleUpdateVariant = (index: number, patch: Partial<VariantRow>) => {
    setVariants((rows) => updateRow(rows, index, patch));
  };
  const handleRemoveVariant = (index: number) => {
    setVariants((rows) => removeRowAt(rows, index));
  };
  const handleAddModifier = () => {
    setModifiers((rows) => addRow(rows, createModifierRow()));
  };
  const handleUpdateModifier = (index: number, patch: Partial<ModifierRow>) => {
    setModifiers((rows) => updateRow(rows, index, patch));
  };
  const handleRemoveModifier = (index: number) => {
    setModifiers((rows) => removeRowAt(rows, index));
  };

  return (
    <div className="space-y-3">
      <form ref={formRef} action={formAction} className="space-y-5">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="menuId" value={menuId} />
        {values?.id ? <input type="hidden" name="itemId" value={values.id} /> : null}
        <input
          type="hidden"
          name="variants"
          value={serializeVariantRows(variants)}
        />
        <input
          type="hidden"
          name="modifiers"
          value={serializeModifierRows(modifiers)}
        />

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

        <VariantsEditor
          rows={variants}
          onAdd={handleAddVariant}
          onUpdate={handleUpdateVariant}
          onRemove={handleRemoveVariant}
        />

        <ModifiersEditor
          rows={modifiers}
          onAdd={handleAddModifier}
          onUpdate={handleUpdateModifier}
          onRemove={handleRemoveModifier}
        />

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
