import type { Metadata } from "next";
import {
  ArrowRight,
  Clock,
  History,
  Settings,
  ShieldCheck,
  Store,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireCurrentUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

type QuickLink = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent?: boolean;
};

const publishingRules = [
  {
    icon: UtensilsCrossed,
    title: "Publishing is versioned",
    description:
      "Editing a published menu creates a draft revision. The public site changes only when you publish.",
  },
  {
    icon: Clock,
    title: "Every change is recorded",
    description:
      "Price changes are logged with the author and timestamp so the history can be reviewed later.",
  },
  {
    icon: ShieldCheck,
    title: "Scans always need review",
    description:
      "QR scan imports always require review. Nothing is applied to a menu automatically.",
  },
];

function QuickLinkCard({ link }: { link: QuickLink }) {
  const Icon = link.icon;

  return (
    <Link
      href={link.href}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-50 opacity-0 transition group-hover:opacity-100"
      />
      <span
        className={
          link.accent
            ? "relative flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm"
            : "relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700"
        }
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="relative mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
        {link.title}
        <ArrowRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" />
      </h2>
      <p className="relative mt-1 text-sm leading-6 text-zinc-600">
        {link.description}
      </p>
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const isAdmin = user.role === "admin";

  const quickLinks: QuickLink[] = [
    {
      href: "/dashboard/restaurants",
      title: "Restaurants",
      description:
        "Create restaurant profiles and manage who can edit them.",
      icon: Store,
      accent: true,
    },
    ...(isAdmin
      ? [
          {
            href: "/dashboard/users",
            title: "Users",
            description:
              "Invite team members, reset passwords, and manage access.",
            icon: Users,
          },
          {
            href: "/dashboard/audit",
            title: "Audit history",
            description:
              "Review sign-ins, permissions, menu changes, and imports.",
            icon: History,
          },
          {
            href: "/dashboard/settings",
            title: "App settings",
            description:
              "Change the public site name, tagline, and support email.",
            icon: Settings,
          },
        ]
      : []),
    {
      href: "/dashboard/account",
      title: "Account security",
      description: "Change your password or sign out of every device.",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Management console"
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="Update restaurant details, maintain menus, and publish price changes from one place. Public visitors always see the latest published menu."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map((link) => (
          <QuickLinkCard key={link.href} link={link} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <h2 className="text-sm font-semibold text-zinc-900">
              Publishing rules
            </h2>
            <ul className="mt-4 space-y-4">
              {publishingRules.map((rule) => {
                const Icon = rule.icon;
                return (
                  <li key={rule.title} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-zinc-900">
                        {rule.title}
                      </p>
                      <p className="mt-0.5 text-sm leading-6 text-zinc-600">
                        {rule.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>

        <Card className="border-amber-200 bg-linear-to-br from-amber-50 to-white">
          <CardBody>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Tip
            </p>
            <h2 className="mt-2 text-sm font-semibold text-zinc-900">
              Keep prices current
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Publish a fresh draft whenever prices or availability change. The
              previous version stays in the history for reference.
            </p>
            <Link
              href="/dashboard/restaurants"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 hover:text-amber-900"
            >
              Open restaurants
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
