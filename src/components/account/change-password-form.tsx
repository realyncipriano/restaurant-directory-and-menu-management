"use client";

import { useActionState } from "react";

import { changePasswordAction } from "@/app/(auth)/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

const inputClass =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label
          htmlFor="currentPassword"
          className="block text-sm font-medium text-zinc-700"
        >
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
        {state.fieldErrors?.currentPassword ? (
          <p className="mt-1 text-xs text-red-600">
            {state.fieldErrors.currentPassword[0]}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-zinc-700"
        >
          New password
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
        {state.fieldErrors?.password ? (
          <p className="mt-1 text-xs text-red-600">
            {state.fieldErrors.password[0]}
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">
            At least 12 characters, using three character types.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-zinc-700"
        >
          Confirm new password
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
        {state.fieldErrors?.confirmPassword ? (
          <p className="mt-1 text-xs text-red-600">
            {state.fieldErrors.confirmPassword[0]}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
