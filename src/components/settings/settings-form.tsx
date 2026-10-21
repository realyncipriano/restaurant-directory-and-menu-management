"use client";

import { useActionState } from "react";

import { updateSettingsAction } from "@/app/dashboard/settings/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function SettingsForm({
  values,
}: {
  values: {
    siteName: string;
    siteTagline: string;
    supportEmail: string;
  };
}) {
  const [state, formAction, pending] = useActionState(
    updateSettingsAction,
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

      <label className="block text-sm font-medium text-zinc-800">
        Site name
        <input
          name="siteName"
          defaultValue={values.siteName}
          required
          maxLength={80}
          className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
        {state.fieldErrors?.siteName ? (
          <span className="mt-1 block text-xs text-red-600">
            {state.fieldErrors.siteName[0]}
          </span>
        ) : null}
      </label>

      <label className="block text-sm font-medium text-zinc-800">
        Tagline
        <input
          name="siteTagline"
          defaultValue={values.siteTagline}
          maxLength={160}
          className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Shown under the site name in the public header.
        </span>
        {state.fieldErrors?.siteTagline ? (
          <span className="mt-1 block text-xs text-red-600">
            {state.fieldErrors.siteTagline[0]}
          </span>
        ) : null}
      </label>

      <label className="block text-sm font-medium text-zinc-800">
        Support email (optional)
        <input
          name="supportEmail"
          type="email"
          defaultValue={values.supportEmail}
          maxLength={254}
          placeholder="help@example.com"
          className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Shown in the public footer so visitors can ask about a listing.
        </span>
        {state.fieldErrors?.supportEmail ? (
          <span className="mt-1 block text-xs text-red-600">
            {state.fieldErrors.supportEmail[0]}
          </span>
        ) : null}
      </label>

      <p className="text-xs leading-5 text-zinc-500">
        Leave the tagline or support email empty to restore the default for that
        field.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
