import type { Metadata } from "next";
import {
  ArrowRight,
  History,
  Settings,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const user = await requireCurrentUser();

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-amber-700">Management console</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Update restaurant details, maintain menus, and publish price changes
          from one place. Public visitors always see the latest published menu.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/dashboard/restaurants"
          className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <Store className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
            Restaurants
            <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" />
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Create restaurant profiles and manage who can edit them.
          </p>
        </Link>

        {user.role === "admin" ? (
          <Link
            href="/dashboard/users"
            className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
              Users
              <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" />
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Invite team members, reset passwords, and manage access.
            </p>
          </Link>
        ) : null}

        {user.role === "admin" ? (
          <Link
            href="/dashboard/audit"
            className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
              <History className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
              Audit history
              <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" />
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Review sign-ins, permissions, menu changes, and imports.
            </p>
          </Link>
        ) : null}

        {user.role === "admin" ? (
          <Link
            href="/dashboard/settings"
            className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
              <Settings className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
              App settings
              <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" />
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Change the public site name, tagline, and support email.
            </p>
          </Link>
        ) : null}

        <Link
          href="/dashboard/account"
          className="group rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
            Account security
            <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" />
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Change your password or sign out of every device.
          </p>
        </Link>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-zinc-900">Publishing rules</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
          <li>
            Published menus are versioned. Editing one creates a draft revision;
            the public site changes only when you publish.
          </li>
          <li>
            Every price change is recorded with the author and timestamp so the
            history can be reviewed later.
          </li>
          <li>
            QR scan imports always require review. Nothing is applied to a menu
            automatically.
          </li>
        </ul>
      </div>
    </div>
  );
}
