"use client";

import { useActionState } from "react";

import { updateScanRetentionAction } from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { EMPTY_FORM_STATE } from "@/lib/action-state";
import {
  MAX_SCAN_RETENTION_DAYS,
  MIN_SCAN_RETENTION_DAYS,
} from "@/lib/validation/settings";

export function ScanRetentionForm({
  retentionDays,
  defaultRetentionDays,
}: {
  retentionDays: number;
  defaultRetentionDays: number;
}) {
  const [state, formAction, pending] = useActionState(
    updateScanRetentionAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <Field
        id="scanRetentionDays"
        label="Keep deleted scans for"
        note={`Deleted scan history and its private source images are permanently removed after this many days. Default: ${defaultRetentionDays} days.`}
        required
        error={state.fieldErrors?.scanRetentionDays?.[0]}
      >
        {(control) => (
          <div className="flex items-center gap-2">
            <Input
              {...control}
              name="scanRetentionDays"
              type="number"
              inputMode="numeric"
              min={MIN_SCAN_RETENTION_DAYS}
              max={MAX_SCAN_RETENTION_DAYS}
              step={1}
              defaultValue={retentionDays}
              className="max-w-32"
            />
            <span className="text-sm text-zinc-600">days</span>
          </div>
        )}
      </Field>

      <div className="border-t border-zinc-100 pt-5">
        <Button
          type="submit"
          variant="secondary"
          isLoading={pending}
          loadingLabel="Saving..."
        >
          Save retention
        </Button>
      </div>
    </form>
  );
}
