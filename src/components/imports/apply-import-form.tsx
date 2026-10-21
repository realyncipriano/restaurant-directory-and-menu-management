"use client";

import { useActionState } from "react";

import { applyImportAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function ApplyImportForm({
  restaurantId,
  importId,
  acceptCount,
}: {
  restaurantId: string;
  importId: string;
  acceptCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    applyImportAction,
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
      <button
        type="submit"
        disabled={pending || acceptCount === 0}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? "Applying..."
          : `Apply ${acceptCount} accepted item${acceptCount === 1 ? "" : "s"} to draft`}
      </button>
      <p className="text-xs text-zinc-500">
        Items missing from the scan are not deleted. Existing items are only
        updated when an accepted scan item matches them.
      </p>
    </form>
  );
}
