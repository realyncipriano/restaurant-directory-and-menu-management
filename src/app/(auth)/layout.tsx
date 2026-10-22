import { Cat } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const instant = false;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <header className="px-6 py-5 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-600 text-white">
            <Cat className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </span>
          Menu Directory
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-20">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm sm:p-8">
            {children}
          </div>
          <p className="mt-6 text-center text-xs text-zinc-500">
            Private workspace for restaurant teams. Public visitors never need
            an account.
          </p>
        </div>
      </main>
    </div>
  );
}
