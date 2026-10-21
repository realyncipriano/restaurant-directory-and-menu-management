import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600">
        The page you are looking for does not exist or is no longer available.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
      >
        Back to the directory
      </Link>
    </div>
  );
}
