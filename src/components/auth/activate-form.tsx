"use client";

import { useActionState } from "react";

import { activateAction } from "@/app/(auth)/actions";
import { Spinner } from "@/components/ui/spinner";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

export function ActivateForm({
  kind,
  token,
  email,
  name,
}: {
  kind: "invite" | "reset";
  token: string;
  email: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(
    activateAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />

      <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
        {kind === "invite" ? "Activating account for " : "Reset link for "}
        <span className="font-medium text-zinc-900">{email}</span>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      {kind === "invite" ? (
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-zinc-700"
          >
            Your name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            defaultValue={name}
            className={inputClass}
          />
        </div>
      ) : null}

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-zinc-700"
        >
          {kind === "reset" ? "New password" : "Choose a password"}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-zinc-500">
          At least 12 characters, using three of: lowercase, uppercase, number,
          symbol.
        </p>
      </div>

      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-zinc-700"
        >
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Spinner className="h-4 w-4" /> : null}
        {pending
          ? "Saving..."
          : kind === "reset"
            ? "Set new password"
            : "Activate account"}
      </button>
    </form>
  );
}
