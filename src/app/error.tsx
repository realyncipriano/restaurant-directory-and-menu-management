"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error", error.digest ?? "");
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600">
        The page could not be loaded. Try again, or contact an administrator if
        the problem continues.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
      >
        Try again
      </button>
    </div>
  );
}
