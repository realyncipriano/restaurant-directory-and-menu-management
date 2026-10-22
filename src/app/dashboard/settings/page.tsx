import type { Metadata } from "next";
import { Settings } from "lucide-react";

import { getDb } from "@/db/client";
import { SettingsForm } from "@/components/settings/settings-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        icon={<Settings className="h-5 w-5" aria-hidden="true" />}
        title="App settings"
        description="Public-facing site identity. These values are shown to visitors across the directory page, restaurant pages, and the footer."
      />

      {notice ? (
        <Notice tone="success">
          Settings saved and the public site was refreshed.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader
            title="Site identity"
            description="Changes take effect immediately on the public site."
          />
          <CardBody>
            <SettingsForm
              values={{
                siteName: settings.siteName,
                siteTagline: settings.siteTagline,
                supportEmail: settings.supportEmail ?? "",
              }}
            />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody>
              <h2 className="text-sm font-semibold text-zinc-900">Preview</h2>
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-semibold text-zinc-900">
                  {settings.siteName}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {settings.siteTagline}
                </p>
              </div>

              <dl className="mt-4 space-y-2 text-xs text-zinc-500">
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

              <p className="mt-4 text-[11px] leading-5 text-zinc-500">
                The site name fallback comes from the{" "}
                <code className="rounded bg-zinc-100 px-1 py-0.5">
                  NEXT_PUBLIC_APP_NAME
                </code>{" "}
                environment variable. Changing settings here does not affect
                stored data or permissions.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
