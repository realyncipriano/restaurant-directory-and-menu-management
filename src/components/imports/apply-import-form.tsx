"use client";

import { useActionState } from "react";

import { applyImportAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
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
    <form action={formAction} className="space-y-2" aria-busy={pending}>
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="importId" value={importId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button
        type="submit"
        variant="success"
        isLoading={pending}
        loadingLabel={`Applying ${acceptCount} item${acceptCount === 1 ? "" : "s"} to draft...`}
        disabled={acceptCount === 0}
      >
        {`Apply ${acceptCount} accepted item${acceptCount === 1 ? "" : "s"} to draft`}
      </Button>
      <p className="text-xs leading-5 text-zinc-500">
        Items missing from the scan are not deleted. Existing items are only
        updated when an accepted scan item matches them.
      </p>
    </form>
  );
}
