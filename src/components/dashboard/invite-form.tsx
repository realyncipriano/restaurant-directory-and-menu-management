"use client";

import { useActionState } from "react";

import { createInviteAction } from "@/app/dashboard/users/actions";
import { CopyButton } from "@/components/copy-button";
import { EMPTY_INVITE_STATE } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

export function InviteForm() {
  const [state, formAction, pending] = useActionState(
    createInviteAction,
    EMPTY_INVITE_STATE,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        {state.error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {state.error}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="invite-email"
              className="block text-sm font-medium text-zinc-700"
            >
              Email
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              className={inputClass}
              placeholder="member@restaurant.ph"
            />
            {state.fieldErrors?.email ? (
              <p className="mt-1 text-xs text-red-600">
                {state.fieldErrors.email[0]}
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="invite-name"
              className="block text-sm font-medium text-zinc-700"
            >
              Name <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <input
              id="invite-name"
              name="name"
              type="text"
              autoComplete="off"
              className={inputClass}
              placeholder="Maria Santos"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating invite..." : "Create invitation"}
        </button>
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
          <p className="mt-2 text-xs text-emerald-800">
            The link is single-use and expires in 7 days. It will only be shown
            once, so copy it now.
          </p>
        </div>
      ) : null}
    </div>
  );
}
