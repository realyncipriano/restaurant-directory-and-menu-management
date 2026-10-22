"use client";

import { useActionState } from "react";

import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FileInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
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
  const inputId = `image-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">{label}</h3>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">{description}</p>
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
        <Notice tone="warning">
          Image uploads are disabled until the R2 credentials and public base URL
          are configured.
        </Notice>
      ) : (
        <>
          <form action={formAction} className="space-y-3" aria-busy={pending}>
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {state.error ? <Notice tone="error">{state.error}</Notice> : null}
            {state.success ? (
              <Notice tone="success">{state.success}</Notice>
            ) : null}
            <Field
              id={inputId}
              label={currentUrl ? "Replace image" : "Upload image"}
              note="JPEG, PNG, or WebP. Up to 5 MB. Images are resized and converted to WebP."
              noteLayout="below"
            >
              {(control) => (
                <FileInput
                  {...control}
                  type="file"
                  name="image"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              isLoading={pending}
              loadingLabel="Optimizing..."
            >
              {currentUrl ? "Replace image" : "Upload image"}
            </Button>
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
