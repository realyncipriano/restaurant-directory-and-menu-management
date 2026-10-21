import type { Metadata } from "next";

import { signOutEverywhereAction } from "@/app/(auth)/actions";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { requireCurrentUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string | string[] }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const updated = params.updated === "1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Account
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Your sign-in details and session security.
        </p>
      </div>

      {updated ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Password updated. Other sessions were signed out.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-zinc-900">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Name
              </dt>
              <dd className="mt-0.5 text-zinc-900">{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Email
              </dt>
              <dd className="mt-0.5 break-all text-zinc-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Role
              </dt>
              <dd className="mt-0.5 text-zinc-900">
                {user.role === "admin" ? "Administrator" : "Authorized user"}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-5 text-zinc-500">
            Ask an administrator to update your name or email address.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-zinc-900">
            Change password
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Updating your password signs out every other device.
          </p>
          <div className="mt-4">
            <ChangePasswordForm />
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-zinc-900">All sessions</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
          Sign out of this browser and every other device immediately. You will
          need to sign in again.
        </p>
        <form action={signOutEverywhereAction} className="mt-4">
          <button
            type="submit"
            className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
          >
            Sign out everywhere
          </button>
        </form>
      </section>
    </div>
  );
}
