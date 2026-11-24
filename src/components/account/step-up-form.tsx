"use client";

import Link from "next/link";
import { useActionState } from "react";

import { stepUpAction } from "@/app/dashboard/step-up/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function StepUpForm({
  next,
  mfaEnabled,
  ttlMinutes,
}: {
  next: string;
  mfaEnabled: boolean;
  ttlMinutes: number;
}) {
  const [state, formAction, pending] = useActionState(
    stepUpAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <Field
        id="stepUpPassword"
        label="Current password"
        note={`Confirm your password to unlock sensitive actions for ${ttlMinutes} minutes.`}
        required
        noteLayout="below"
        error={state.fieldErrors?.password?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
          />
        )}
      </Field>

      {mfaEnabled ? (
        <Field
          id="stepUpCode"
          label="Authenticator or recovery code"
          note="Enter a current 6-digit code, or one unused recovery code."
          required
          noteLayout="below"
          error={state.fieldErrors?.code?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              className="font-mono tracking-[0.2em]"
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          isLoading={pending}
          loadingLabel="Verifying..."
        >
          Verify and continue
        </Button>
        <Link
          href={next}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
