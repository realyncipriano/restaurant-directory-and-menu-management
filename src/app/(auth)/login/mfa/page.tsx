import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MfaLoginForm } from "@/components/auth/mfa-login-form";
import { Notice } from "@/components/ui/notice";
import { safeRedirectPath } from "@/lib/action-state";
import { readMfaChallengeToken } from "@/lib/auth/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Verify sign-in",
  robots: { index: false, follow: false },
};

export default async function MfaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    notice?: string | string[];
  }>;
}) {
  if (!(await readMfaChallengeToken())) {
    redirect("/login");
  }

  const params = await searchParams;
  const next = safeRedirectPath(
    typeof params.next === "string" ? params.next : undefined,
  );
  const notice =
    typeof params.notice === "string" ? params.notice : undefined;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Verify your sign-in
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        Your password was accepted. Confirm the second factor to finish signing
        in.
      </p>

      {notice === "password_reset" ? (
        <Notice tone="success" className="mt-5">
          Password updated. Verify with your authenticator or a recovery code to
          continue.
        </Notice>
      ) : null}
      {notice === "account_activated" ? (
        <Notice tone="success" className="mt-5">
          Account activated. Verify with your authenticator or a recovery code
          to continue.
        </Notice>
      ) : null}

      <div className="mt-6">
        <MfaLoginForm next={next} />
      </div>

      <div className="mt-6 border-t border-zinc-100 pt-4">
        <Link
          href="/login"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
