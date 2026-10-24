import { Plus, Trash2 } from "lucide-react";

import { SectionHint } from "@/components/menus/item-form/section-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ModifierRow } from "@/lib/menu-item-rows";

export function ModifiersEditor({
  rows,
  onAdd,
  onUpdate,
  onRemove,
}: {
  rows: readonly ModifierRow[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<ModifierRow>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <fieldset className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4">
      <SectionHint
        title="Add-ons"
        description="Optional extras with an additional price, e.g. Extra rice."
        action={
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add add-on
          </Button>
        }
      />

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_5rem_2rem]">
            <span>Name</span>
            <span>Extra price</span>
            <span>Available</span>
            <span />
          </div>
          {rows.map((modifier, index) => (
            <div
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_2rem]"
            >
              <Input
                value={modifier.name}
                onChange={(event) =>
                  onUpdate(index, { name: event.target.value })
                }
                className="py-2"
                placeholder="Extra rice"
                aria-label={`Add-on ${index + 1} name`}
              />
              <Input
                value={modifier.price}
                onChange={(event) =>
                  onUpdate(index, { price: event.target.value })
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
                    onUpdate(index, { isAvailable: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-600/40"
                />
                Available
              </label>
              <button
                type="button"
                onClick={() => onRemove(index)}
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
  );
}
