import type { Metadata } from "next";
import { ShieldCheck, UserCircle } from "lucide-react";

import { signOutEverywhereAction } from "@/app/(auth)/actions";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { buttonClass } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
} from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
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

      <Card className="border-red-200 bg-red-50/30">
        <CardBody>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <ShieldCheck className="h-4 w-4 text-red-600" aria-hidden="true" />
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
