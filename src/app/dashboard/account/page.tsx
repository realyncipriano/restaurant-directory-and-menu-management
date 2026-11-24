import type { Metadata } from "next";
import { Laptop, ShieldCheck, UserCircle } from "lucide-react";

import { signOutEverywhereAction } from "@/app/(auth)/actions";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
} from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db/client";
import { getSessionIdleTtlSeconds } from "@/lib/auth/constants";
import { requireCurrentUser } from "@/lib/auth/guards";
import { describeUserAgent } from "@/lib/user-agent";
import { listUserSessions } from "@/server/services/auth";
import { revokeSessionAction } from "./actions";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const errorMessages: Record<string, string> = {
  session_invalid: "That session reference is not valid.",
  session_missing: "That session was already signed out or has expired.",
  failed: "The session could not be revoked. Please try again.",
};

function formatTimestamp(value: Date): string {
  return `${dateFormatter.format(value)} UTC`;
}

function idleWindowLabel(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    updated?: string | string[];
    notice?: string | string[];
    error?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const [sessions, params] = await Promise.all([
    listUserSessions(getDb(), {
      actorId: user.id,
      currentSessionId: user.sessionId,
    }),
    searchParams,
  ]);

  const updated = params.updated === "1";
  const notice = first(params.notice);
  const error = first(params.error);
  const idleWindow = idleWindowLabel(getSessionIdleTtlSeconds());

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<UserCircle className="h-5 w-5" aria-hidden="true" />}
        title="Account"
        description="Your sign-in details and session security."
      />

      {updated ? (
        <Notice tone="success">
          Password updated. Other sessions were signed out.
        </Notice>
      ) : null}
      {notice === "session_revoked" ? (
        <Notice tone="success">That session was signed out.</Notice>
      ) : null}
      {error ? (
        <Notice tone="error">{errorMessages[error] ?? errorMessages.failed}</Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <dl className="space-y-3 text-sm">
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
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Change password"
            description="Updating your password signs out every other device."
          />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          icon={<Laptop className="h-4 w-4 text-zinc-500" aria-hidden="true" />}
          title="Active sessions"
          description={`Sessions inactive for ${idleWindow} are signed out automatically. Every session also expires 7 days after sign-in.`}
        />
        <CardBody>
          {sessions.length === 0 ? (
            <p className="text-sm leading-6 text-zinc-600">
              No active sessions were found.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {sessions.map((session) => {
                const lastActiveAt = session.lastUsedAt ?? session.createdAt;
                return (
                  <li
                    key={session.id}
                    className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-zinc-900">
                          {describeUserAgent(session.userAgent)}
                        </p>
                        {session.isCurrent ? (
                          <Badge tone="success">This device</Badge>
                        ) : null}
                      </div>
                      <dl className="mt-2 space-y-1 text-xs leading-5 text-zinc-500">
                        <div className="flex flex-wrap gap-1">
                          <dt>Signed in</dt>
                          <dd>
                            <time dateTime={session.createdAt.toISOString()}>
                              {formatTimestamp(session.createdAt)}
                            </time>
                          </dd>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <dt>Last active</dt>
                          <dd>
                            <time dateTime={lastActiveAt.toISOString()}>
                              {formatTimestamp(lastActiveAt)}
                            </time>
                          </dd>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <dt>Expires</dt>
                          <dd>
                            <time dateTime={session.expiresAt.toISOString()}>
                              {formatTimestamp(session.expiresAt)}
                            </time>
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <form action={revokeSessionAction}>
                      <input
                        type="hidden"
                        name="sessionId"
                        value={session.id}
                      />
                      <button
                        type="submit"
                        className={buttonClass({
                          variant: session.isCurrent ? "outline" : "danger",
                          size: "sm",
                        })}
                      >
                        {session.isCurrent ? "Sign out this device" : "Revoke"}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="border-red-200 bg-red-50/30">
        <CardBody>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <ShieldCheck className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
            All sessions
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
            Sign out of this browser and every other device immediately. You will
            need to sign in again.
          </p>
          <form action={signOutEverywhereAction} className="mt-4">
            <button
              type="submit"
              className={buttonClass({ variant: "danger" })}
            >
              Sign out everywhere
            </button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
