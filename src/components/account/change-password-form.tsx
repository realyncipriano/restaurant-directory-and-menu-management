"use client";

import { useActionState } from "react";

import { changePasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <Field
        id="currentPassword"
        label="Current password"
        note="Enter your existing password to confirm this change."
        required
        error={state.fieldErrors?.currentPassword?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
          />
        )}
      </Field>

      <Field
        id="password"
        label="New password"
        note="At least 12 characters, using three character types. Avoid reusing a password from another site."
        required
        error={state.fieldErrors?.password?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
          />
        )}
      </Field>

      <Field
        id="confirmPassword"
        label="Confirm new password"
        note="Re-enter the new password exactly."
        required
        error={state.fieldErrors?.confirmPassword?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
          />
        )}
      </Field>

      <div className="border-t border-zinc-100 pt-5">
        <Button
          type="submit"
          variant="secondary"
          isLoading={pending}
          loadingLabel="Updating..."
        >
          Update password
        </Button>
      </div>
    </form>
  );
}
