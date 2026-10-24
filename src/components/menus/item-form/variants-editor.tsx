import { Plus, Trash2 } from "lucide-react";

import { SectionHint } from "@/components/menus/item-form/section-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VariantRow } from "@/lib/menu-item-rows";

export function VariantsEditor({
  rows,
  onAdd,
  onUpdate,
  onRemove,
}: {
  rows: readonly VariantRow[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<VariantRow>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <fieldset className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4">
      <SectionHint
        title="Variants"
        description="Sizes or servings with their own price, e.g. Regular and Large."
        action={
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add variant
          </Button>
        }
      />

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_2rem]">
            <span>Name</span>
            <span>Price (PHP)</span>
            <span />
          </div>
          {rows.map((variant, index) => (
            <div
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_2rem]"
            >
              <Input
                value={variant.name}
                onChange={(event) =>
                  onUpdate(index, { name: event.target.value })
                }
                className="py-2"
                placeholder="Regular"
                aria-label={`Variant ${index + 1} name`}
              />
              <Input
                value={variant.price}
                onChange={(event) =>
                  onUpdate(index, { price: event.target.value })
                }
                className="col-start-1 py-2 sm:col-start-auto"
                placeholder="185.00"
                inputMode="decimal"
                aria-label={`Variant ${index + 1} price`}
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
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
  );
}
