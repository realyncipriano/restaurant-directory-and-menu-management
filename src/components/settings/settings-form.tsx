"use client";

import { useActionState } from "react";

import { updateSettingsAction } from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
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
    <form action={formAction} className="space-y-5">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <Field
        id="siteName"
        label="Site name"
        note="Shown in the public header, page titles, and footer."
        required
        error={state.fieldErrors?.siteName?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="siteName"
            defaultValue={values.siteName}
            maxLength={80}
          />
        )}
      </Field>

      <Field
        id="siteTagline"
        label="Tagline"
        note="Shown under the site name in the public header."
        optional
        error={state.fieldErrors?.siteTagline?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="siteTagline"
            defaultValue={values.siteTagline}
            maxLength={160}
          />
        )}
      </Field>

      <Field
        id="supportEmail"
        label="Support email"
        note="Shown in the public footer so visitors can ask about a listing."
        optional
        error={state.fieldErrors?.supportEmail?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="supportEmail"
            type="email"
            defaultValue={values.supportEmail}
            maxLength={254}
            placeholder="help@example.com"
          />
        )}
      </Field>

      <Notice tone="info">
        Leave the tagline or support email empty to restore the default for that
        field.
      </Notice>

      <div className="border-t border-zinc-100 pt-5">
        <Button
          type="submit"
          variant="secondary"
          isLoading={pending}
          loadingLabel="Saving..."
        >
          Save settings
        </Button>
      </div>
    </form>
  );
}
