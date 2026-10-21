import type { Metadata } from "next";
import { Settings } from "lucide-react";

import { getDb } from "@/db/client";
import { SettingsForm } from "@/components/settings/settings-form";
import { requireAdminUser } from "@/lib/auth/guards";
import {
  defaultAppSettings,
  getAppSettings,
} from "@/server/services/app-settings";

export const metadata: Metadata = {
  title: "App settings",
  robots: { index: false, follow: false },
};

export default async function AppSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const admin = await requireAdminUser();
  const query = await searchParams;
  const settings = await getAppSettings(getDb());
  const defaults = defaultAppSettings();
  const notice = query.notice === "saved";

  void admin;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900">
          <Settings className="h-6 w-6 text-amber-700" aria-hidden="true" />
          App settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Public-facing site identity. These values are shown to visitors across
          the directory page, restaurant pages, and the footer.
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Settings saved and the public site was refreshed.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <SettingsForm
            values={{
              siteName: settings.siteName,
              siteTagline: settings.siteTagline,
              supportEmail: settings.supportEmail ?? "",
            }}
          />
        </section>

        <section className="h-fit space-y-4 rounded-2xl border border-zinc-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Preview</h2>
            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm font-semibold text-zinc-900">
                {settings.siteName}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {settings.siteTagline}
              </p>
            </div>
          </div>

          <dl className="space-y-2 text-xs text-zinc-500">
            <div className="flex justify-between gap-3">
              <dt>Default name</dt>
              <dd className="truncate text-right text-zinc-700">
                {defaults.siteName}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Default tagline</dt>
              <dd className="truncate text-right text-zinc-700">
                {defaults.siteTagline}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Support email</dt>
              <dd className="truncate text-right text-zinc-700">
                {settings.supportEmail ?? "Not set"}
              </dd>
            </div>
          </dl>

          <p className="text-[11px] leading-5 text-zinc-500">
            The site name fallback comes from the <code>NEXT_PUBLIC_APP_NAME</code>{" "}
            environment variable. Changing settings here does not affect stored
            data or permissions.
          </p>
        </section>
      </div>
    </div>
  );
}
