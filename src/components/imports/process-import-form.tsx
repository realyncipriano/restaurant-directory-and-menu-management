"use client";

import { useActionState } from "react";

import { processImportAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function ProcessImportForm({
  restaurantId,
  importId,
  label = "Extract menu items",
}: {
  restaurantId: string;
  importId: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(
    processImportAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="importId" value={importId} />
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
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Reading menu pages..." : label}
      </button>
    </form>
  );
}
