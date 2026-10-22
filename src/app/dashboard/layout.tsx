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
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex items-center justify-between gap-4">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-amber-500 to-amber-700 text-white shadow-sm">
                <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-zinc-900">
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
            <DashboardNav isAdmin={user.role === "admin"} />

            <div className="flex items-center gap-3 border-t border-zinc-100 pt-3 sm:border-0 sm:pt-0">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-zinc-900">{user.name}</p>
                <p className="text-xs text-zinc-500">
                  {user.role === "admin" ? "Administrator" : "Team member"}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white ring-2 ring-white"
              >
                {initials || "?"}
              </span>
              <form action={logoutAction} className="hidden lg:block">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        {children}
      </main>
    </div>
  );
}
