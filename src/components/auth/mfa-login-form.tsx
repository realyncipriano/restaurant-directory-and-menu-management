"use client";

import { useActionState } from "react";

import { mfaLoginAction } from "@/app/(auth)/actions";
import { Spinner } from "@/components/ui/spinner";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-surface px-3 py-2.5 text-center text-lg tracking-[0.3em] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/20";

export function MfaLoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(
    mfaLoginAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label
          htmlFor="code"
          className="block text-sm font-medium text-zinc-700"
        >
          Authentication code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          maxLength={32}
          className={inputClass}
          placeholder="123456"
        />
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Enter the 6-digit code from your authenticator app, or one of your
          recovery codes.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Spinner className="h-4 w-4" /> : null}
        {pending ? "Verifying..." : "Verify and sign in"}
      </button>
    </form>
  );
}
