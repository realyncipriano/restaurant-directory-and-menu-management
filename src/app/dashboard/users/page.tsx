import type { Metadata } from "next";

import { getDb } from "@/db/client";
import { InviteForm } from "@/components/dashboard/invite-form";
import { ResetLinkForm } from "@/components/dashboard/reset-link-form";
import { requireAdminUser } from "@/lib/auth/guards";
import { listUsers } from "@/server/services/auth";
import {
  deactivateUserAction,
  reactivateUserAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

const statusStyles: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  invited: "bg-amber-50 text-amber-700 ring-amber-600/20",
  deactivated: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
};

function Notice({
  notice,
  error,
}: {
  notice?: string;
  error?: string;
}) {
  if (error) {
    const message =
      error === "conflict"
        ? "That change is not allowed. At least one active administrator must remain, and you cannot deactivate yourself."
        : "The action could not be completed. Please try again.";
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {message}
      </p>
    );
  }
  if (notice === "deactivated") {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Account deactivated and signed out everywhere.
      </p>
    );
  }
  if (notice === "reactivated") {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Account reactivated. The user can sign in with their existing password.
      </p>
    );
  }
  return null;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[]; error?: string | string[] }>;
}) {
  const admin = await requireAdminUser();
  const params = await searchParams;
  const users = await listUsers(getDb(), admin.id);

  const notice = typeof params.notice === "string" ? params.notice : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Users
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Invite team members and control access. There is no public sign-up;
          every account starts with a single-use invitation.
        </p>
      </div>

      <Notice notice={notice} error={error} />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-zinc-900">
          Invite a team member
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          The invitation link is shown once and expires in seven days.
        </p>
        <div className="mt-4">
          <InviteForm />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            Team accounts
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {users.length} account{users.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="divide-y divide-zinc-100">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {user.name}
                  </p>
                  {user.id === admin.id ? (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      You
                    </span>
                  ) : null}
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      statusStyles[user.accountStatus] ?? statusStyles.deactivated
                    }`}
                  >
                    {user.accountStatus}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-zinc-600">
                  {user.email}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {user.role === "admin" ? "Administrator" : "Authorized user"}
                  {user.lastLoginAt
                    ? ` · Last sign-in ${new Intl.DateTimeFormat("en-PH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(user.lastLoginAt)}`
                    : " · Never signed in"}
                </p>
              </div>

              <div className="flex flex-wrap items-start gap-3 sm:justify-end">
                {user.accountStatus === "active" ? (
                  <ResetLinkForm userId={user.id} />
                ) : null}

                {user.accountStatus === "deactivated" ? (
                  <form action={reactivateUserAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Reactivate
                    </button>
                  </form>
                ) : null}

                {user.id !== admin.id ? (
                  <form action={deactivateUserAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Deactivate
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
