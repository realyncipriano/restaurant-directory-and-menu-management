"use client";

import { useActionState } from "react";

import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/action-state";

export function ImageUploadForm({
  action,
  removeAction,
  hidden,
  currentUrl,
  label,
  description,
  configured,
  removeLabel = "Remove image",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  removeAction?: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  currentUrl: string | null;
  label: string;
  description?: string;
  configured: boolean;
  removeLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">{label}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
        ) : null}
      </div>

      {currentUrl ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt={label}
            className="h-40 w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-xs text-zinc-400">
          No image yet
        </div>
      )}

      {!configured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Image uploads are disabled until the R2 credentials and public base URL
          are configured.
        </p>
      ) : (
        <>
          <form action={formAction} className="space-y-2">
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {state.error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {state.error}
              </p>
            ) : null}
            {state.success ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {state.success}
              </p>
            ) : null}
            <input
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp"
              required
              className="block w-full cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
            />
            <p className="text-[11px] text-zinc-500">
              JPEG, PNG, or WebP. Up to 5 MB. Images are resized and converted to
              WebP.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Uploading..." : "Upload image"}
            </button>
          </form>

          {removeAction && currentUrl ? (
            <form action={removeAction}>
              {Object.entries(hidden).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <ConfirmButton
                message={`${removeLabel}? This cannot be undone.`}
                className="text-xs font-medium text-red-600 hover:text-red-700"
              >
                {removeLabel}
              </ConfirmButton>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
