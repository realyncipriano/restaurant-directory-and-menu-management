import type { Metadata } from "next";
import Link from "next/link";

import { getDb } from "@/db/client";
import { ActivateForm } from "@/components/auth/activate-form";
import { getActivationContext } from "@/server/services/auth";

export const instant = false;

export const metadata: Metadata = {
  title: "Activate account",
  robots: { index: false, follow: false },
};

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const context = token
    ? await getActivationContext(getDb(), token)
    : null;

  if (!token || !context) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Link unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          This link is invalid, has already been used, or has expired. Ask an
          administrator to send a new invitation or password reset link.
        </p>
        <div className="mt-6 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          For security, activation links are single-use. Password reset links
          expire after one hour; invitations expire after seven days.
        </div>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-amber-700 hover:text-amber-800"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        {context.kind === "password_reset" ? "Set a new password" : "Activate your account"}
      </h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        {context.kind === "password_reset"
          ? "Choose a new password. All existing sessions will be signed out."
          : "Confirm your details and choose a password to finish setting up your account."}
      </p>
      <div className="mt-6">
        <ActivateForm
          kind={context.kind === "password_reset" ? "reset" : "invite"}
          token={token}
          email={context.email}
          name={context.name}
        />
      </div>
    </div>
  );
}
