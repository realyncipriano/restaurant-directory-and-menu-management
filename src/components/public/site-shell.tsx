import { UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { getRequestAppSettings } from "@/server/services/app-settings-request";

export async function SiteShell({ children }: { children: ReactNode }) {
  const settings = await getRequestAppSettings();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white">
              <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-zinc-900">
                {settings.siteName}
              </span>
              <span className="block text-xs text-zinc-500">
                {settings.siteTagline}
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden text-sm font-medium text-zinc-600 hover:text-zinc-900 sm:block"
            >
              Browse restaurants
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Staff sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{settings.siteName}</p>
          <p>
            Menus and prices are maintained by the restaurant teams. Confirm
            details with the restaurant before ordering.
            {settings.supportEmail ? (
              <>
                {" "}
                <a
                  href={`mailto:${settings.supportEmail}`}
                  className="font-medium text-amber-800 hover:underline"
                >
                  Contact support
                </a>
                .
              </>
            ) : null}
          </p>
        </div>
      </footer>
    </div>
  );
}
