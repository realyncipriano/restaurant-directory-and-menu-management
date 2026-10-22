import type { Metadata } from "next";
import { UserPlus, Users } from "lucide-react";

import { getDb } from "@/db/client";
import { InviteForm } from "@/components/dashboard/invite-form";
import { ResetLinkForm } from "@/components/dashboard/reset-link-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
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

const statusTones: Record<string, BadgeTone> = {
  active: "success",
  invited: "warning",
  deactivated: "neutral",
};

function NoticeMessage({
  notice,
  error,
}: {
  notice?: string;
  error?: string;
}) {
  if (error) {
    return (
      <Notice tone="error">
        {error === "conflict"
          ? "That change is not allowed. At least one active administrator must remain, and you cannot deactivate yourself."
          : "The action could not be completed. Please try again."}
      </Notice>
    );
  }
  if (notice === "deactivated") {
    return (
      <Notice tone="success">
        Account deactivated and signed out everywhere.
      </Notice>
    );
  }
  if (notice === "reactivated") {
    return (
      <Notice tone="success">
        Account reactivated. The user can sign in with their existing password.
      </Notice>
    );
  }
  return null;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
    <div className="space-y-6">
      <PageHeader
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        title="Users"
        description="Invite team members and control access. There is no public sign-up; every account starts with a single-use invitation."
      />

      <NoticeMessage notice={notice} error={error} />

      <Card>
        <CardHeader
          icon={<UserPlus className="h-4 w-4 text-amber-700" aria-hidden="true" />}
          title="Invite a team member"
          description="The invitation link is shown once and expires in seven days."
        />
        <CardBody>
          <InviteForm />
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Team accounts"
          description={`${users.length} account${users.length === 1 ? "" : "s"}`}
        />

        <div className="divide-y divide-zinc-100">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-4 px-5 py-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700"
                >
                  {initialsFor(user.name) || "?"}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {user.name}
                    </p>
                    {user.id === admin.id ? (
                      <Badge tone="neutral">You</Badge>
                    ) : null}
                    <Badge tone={statusTones[user.accountStatus] ?? "neutral"}>
                      {user.accountStatus}
                    </Badge>
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
              </div>

              <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                {user.accountStatus === "active" ? (
                  <ResetLinkForm userId={user.id} />
                ) : null}

                {user.accountStatus === "deactivated" ? (
                  <form action={reactivateUserAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button
                      type="submit"
                      className={buttonClass({
                        variant: "outline",
                        size: "sm",
                      })}
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
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      Deactivate
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
