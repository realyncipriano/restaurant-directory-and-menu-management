import { LogOut, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { logoutAction } from "@/app/(auth)/actions";
import { DashboardNav } from "@/components/dashboard/nav";
import { requireCurrentUser } from "@/lib/auth/guards";
import { getRequestAppSettings } from "@/server/services/app-settings-request";

export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireCurrentUser();
  const settings = await getRequestAppSettings();
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white">
                <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-zinc-900">
                  {settings.siteName}
                </span>
                <span className="block text-xs text-zinc-500">
                  Management console
                </span>
              </span>
            </Link>
            <form action={logoutAction} className="lg:hidden">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <DashboardNav isAdmin={user.role === "admin"} />
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-zinc-900">{user.name}</p>
                <p className="text-xs text-zinc-500">
                  {user.role === "admin" ? "Administrator" : "Team member"}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white"
              >
                {initials || "?"}
              </span>
              <form action={logoutAction} className="hidden lg:block">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
