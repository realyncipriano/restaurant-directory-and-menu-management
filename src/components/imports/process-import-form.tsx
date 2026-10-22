"use client";

import { useActionState, useEffect, useState } from "react";

import { processImportAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  return (
    <form
      action={formAction}
      onSubmit={() => setElapsedSeconds(0)}
      className="space-y-2"
      aria-busy={pending}
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="importId" value={importId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <Button
        type="submit"
        variant="secondary"
        isLoading={pending}
        loadingLabel="Scanning menu..."
      >
        {label}
      </Button>
      {pending ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-900"
        >
          <p className="flex items-center gap-2 font-medium">
            <Spinner className="h-3.5 w-3.5 shrink-0" />
            Scanning menu images with AI
            {elapsedSeconds > 0 ? ` — ${elapsedSeconds}s elapsed` : "..."}
          </p>
          <p className="mt-1 text-sky-700">
            This can take up to 3 minutes. Keep this page open.
          </p>
        </div>
      ) : null}
    </form>
  );
}
