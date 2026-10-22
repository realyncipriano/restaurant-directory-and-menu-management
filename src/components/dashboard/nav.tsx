"use client";

import {
  History,
  LayoutDashboard,
  Settings,
  Store,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const primaryLinks: NavLink[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/restaurants", label: "Restaurants", icon: Store },
];

const adminLinks: NavLink[] = [
  { href: "/dashboard/users", label: "Users", icon: Users },
  { href: "/dashboard/audit", label: "Audit", icon: History },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const accountLinks: NavLink[] = [
  { href: "/dashboard/account", label: "Account", icon: UserCircle },
];

function NavGroup({
  links,
  pathname,
}: {
  links: NavLink[];
  pathname: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {links.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname === link.href
            : pathname.startsWith(link.href);
        const Icon = link.icon;

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-white text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200/80"
                : "text-zinc-600 hover:bg-white/70 hover:text-zinc-900",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 hidden h-5 w-px shrink-0 bg-zinc-200 sm:block"
    />
  );
}

export function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Management console"
      className="flex items-center gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 [scrollbar-width:none]"
    >
      <NavGroup links={primaryLinks} pathname={pathname} />
      {isAdmin ? (
        <>
          <Divider />
          <NavGroup links={adminLinks} pathname={pathname} />
        </>
      ) : null}
      <Divider />
      <NavGroup links={accountLinks} pathname={pathname} />
    </nav>
  );
}
