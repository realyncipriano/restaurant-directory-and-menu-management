import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";
import { safeRedirectPath } from "@/lib/action-state";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(
    typeof params.next === "string" ? params.next : undefined,
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage restaurant menus, prices, and published listings.
      </p>
      <div className="mt-6">
        <LoginForm next={next} />
      </div>
      <div className="mt-6 border-t border-zinc-100 pt-4">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          Back to the public directory
        </Link>
      </div>
    </div>
  );
}
