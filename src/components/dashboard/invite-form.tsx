"use client";

import { useActionState } from "react";

import { createInviteAction } from "@/app/dashboard/users/actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { EMPTY_INVITE_STATE } from "@/lib/action-state";

export function InviteForm() {
  const [state, formAction, pending] = useActionState(
    createInviteAction,
    EMPTY_INVITE_STATE,
  );

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5">
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}

        <Field
          id="invite-email"
          label="Email"
          note="The invitation is tied to this address. There is no public sign-up, so this must be the person's real work email."
          required
          error={state.fieldErrors?.email?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="email"
              type="email"
              autoComplete="off"
              placeholder="member@restaurant.ph"
            />
          )}
        </Field>

        <Field
          id="invite-name"
          label="Name"
          note="Shown in the account list and audit history. You can leave it blank and let the member fill it in later."
          optional
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              type="text"
              autoComplete="off"
              placeholder="Maria Santos"
            />
          )}
        </Field>

        <div className="border-t border-zinc-100 pt-5">
          <Button
            type="submit"
            variant="secondary"
            isLoading={pending}
            loadingLabel="Creating invite..."
          >
            Create invitation
          </Button>
        </div>
      </form>

      {state.inviteUrl ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">
            {state.success}
            {state.inviteEmail ? ` (${state.inviteEmail})` : ""}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs text-zinc-700">
              {state.inviteUrl}
            </code>
            <CopyButton value={state.inviteUrl} />
          </div>
          <p className="mt-2 text-xs leading-5 text-emerald-800">
            The link is single-use and expires in 7 days. It will only be shown
            once, so copy it now.
          </p>
        </div>
      ) : null}
    </div>
  );
}
