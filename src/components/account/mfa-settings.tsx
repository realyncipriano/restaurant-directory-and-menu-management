"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  beginMfaEnrollmentAction,
  cancelMfaEnrollmentAction,
  confirmMfaEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
} from "@/app/dashboard/account/mfa-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { EMPTY_MFA_STATE } from "@/lib/action-state";

export type MfaSettingsProps = {
  enabled: boolean;
  enabledSince: string | null;
  pending: boolean;
  recoveryCodesRemaining: number;
  required: boolean;
  secret: string | null;
  qrDataUrl: string | null;
};

function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Save these recovery codes now
      </p>
      <p className="mt-1 text-xs leading-5 text-amber-900/80">
        Each code can be used once if you lose access to your authenticator.
        Store them somewhere safe; they will not be shown again.
      </p>
      <ul className="mt-3 grid gap-1.5 font-mono text-sm text-amber-950 sm:grid-cols-2">
        {codes.map((code) => (
          <li
            key={code}
            className="select-all rounded-md border border-amber-200 bg-white/70 px-2.5 py-1.5"
          >
            {code}
          </li>
        ))}
      </ul>
      <Link
        href="/dashboard/account?mfa=enabled"
        className="mt-4 inline-block text-sm font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
      >
        I have saved these codes
      </Link>
    </div>
  );
}

function CodeField({
  id,
  label,
  note,
  error,
}: {
  id: string;
  label: string;
  note: string;
  error?: string;
}) {
  return (
    <Field
      id={id}
      label={label}
      note={note}
      required
      noteLayout="below"
      error={error}
    >
      {(control) => (
        <Input
          {...control}
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          className="font-mono tracking-[0.2em]"
        />
      )}
    </Field>
  );
}

function ConfirmEnrollmentForm() {
  const [state, formAction, pending] = useActionState(
    confirmMfaEnrollmentAction,
    EMPTY_MFA_STATE,
  );

  if (state.recoveryCodes) {
    return <RecoveryCodeList codes={state.recoveryCodes} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <CodeField
        id="enrollmentCode"
        label="Authenticator code"
        note="Enter the 6-digit code currently shown in your authenticator app."
        error={state.fieldErrors?.code?.[0]}
      />
      <Button
        type="submit"
        variant="success"
        isLoading={pending}
        loadingLabel="Verifying..."
      >
        Enable multi-factor authentication
      </Button>
      <Button type="submit" variant="ghost" size="sm" formAction={cancelMfaEnrollmentAction}>
        Cancel setup
      </Button>
    </form>
  );
}

function RegenerateRecoveryCodesForm() {
  const [state, formAction, pending] = useActionState(
    regenerateRecoveryCodesAction,
    EMPTY_MFA_STATE,
  );

  if (state.recoveryCodes) {
    return <RecoveryCodeList codes={state.recoveryCodes} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <CodeField
        id="regenerateCode"
        label="Confirm with an authenticator or recovery code"
        note="Generating new codes invalidates every existing recovery code."
        error={state.fieldErrors?.code?.[0]}
      />
      <Button
        type="submit"
        variant="outline"
        isLoading={pending}
        loadingLabel="Generating..."
      >
        Generate new recovery codes
      </Button>
    </form>
  );
}

function DisableMfaForm() {
  const [state, formAction, pending] = useActionState(
    disableMfaAction,
    EMPTY_MFA_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Field
        id="disableMfaPassword"
        label="Current password"
        required
        noteLayout="below"
        error={state.fieldErrors?.password?.[0]}
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="current-password"
          />
        )}
      </Field>
      <CodeField
        id="disableMfaCode"
        label="Authenticator or recovery code"
        note="Enter a current 6-digit code or one unused recovery code."
        error={state.fieldErrors?.code?.[0]}
      />
      <Button
        type="submit"
        variant="danger"
        isLoading={pending}
        loadingLabel="Disabling..."
      >
        Disable multi-factor authentication
      </Button>
    </form>
  );
}

export function MfaSettings({
  enabled,
  enabledSince,
  pending,
  recoveryCodesRemaining,
  required,
  secret,
  qrDataUrl,
}: MfaSettingsProps) {
  if (enabled) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="success">Enabled</Badge>
          <p className="text-sm text-zinc-600">
            {enabledSince ? `Enabled ${enabledSince}. ` : ""}
            {recoveryCodesRemaining} unused recovery{" "}
            {recoveryCodesRemaining === 1 ? "code" : "codes"} remaining.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 p-4">
          <h3 className="text-sm font-semibold text-zinc-900">
            Recovery codes
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Replace your recovery codes if they were lost or may have been
            exposed. Existing codes stop working immediately.
          </p>
          <div className="mt-4">
            <RegenerateRecoveryCodesForm />
          </div>
        </div>

        <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
          <h3 className="text-sm font-semibold text-zinc-900">
            Disable multi-factor authentication
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Disabling MFA makes your password the only sign-in factor. Other
            sessions are signed out, and this device stays signed in.
          </p>
          <div className="mt-4">
            <DisableMfaForm />
          </div>
        </div>
      </div>
    );
  }

  if (pending && secret && qrDataUrl) {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-6 text-zinc-600">
          Scan this QR code with an authenticator app such as 1Password,
          Bitwarden, Google Authenticator, or Microsoft Authenticator.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="QR code for authenticator setup"
            width={208}
            height={208}
            className="h-52 w-52 rounded-xl border border-zinc-200 bg-white p-2"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Can&apos;t scan the QR code?
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Enter this setup key manually in your authenticator app:
            </p>
            <code className="mt-2 block select-all break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm text-zinc-900">
              {secret}
            </code>
          </div>
        </div>

        <ConfirmEnrollmentForm />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {required ? (
        <Notice tone="warning" title="Administrator MFA is required">
          Your administrator account must enable multi-factor authentication
          before administrator tools become available.
        </Notice>
      ) : null}
      <p className="text-sm leading-6 text-zinc-600">
        Add a second factor to your password with any TOTP authenticator app.
        You will confirm a 6-digit code and receive single-use recovery codes.
      </p>
      <form action={beginMfaEnrollmentAction}>
        <Button type="submit" variant="secondary">
          Set up authenticator app
        </Button>
      </form>
    </div>
  );
}
