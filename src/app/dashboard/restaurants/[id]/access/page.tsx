import type { Metadata } from "next";
import { ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import {
  removePermissionAction,
  setPermissionAction,
} from "@/app/dashboard/restaurants/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import {
  getRestaurantDetail,
  listAssignableUsers,
} from "@/server/services/restaurants";

export const metadata: Metadata = {
  title: "Restaurant access",
  robots: { index: false, follow: false },
};

const checkboxClass =
  "mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-amber-600 focus:ring-2 focus:ring-amber-600/40";

const permissionOptions = [
  {
    name: "canEditMenu",
    label: "Edit menus",
    description: "Create drafts, categories, and items.",
  },
  {
    name: "canPublishMenu",
    label: "Publish",
    description: "Make a reviewed draft live to visitors.",
  },
  {
    name: "canManageRestaurant",
    label: "Manage profile",
    description: "Update public details and images.",
  },
] as const;

export default async function RestaurantAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
  }>;
}) {
  const admin = await requireAdminUser();
  const { id } = await params;
  const query = await searchParams;

  let detail;
  let users;
  try {
    detail = await getRestaurantDetail(getDb(), admin.id, id);
    users = await listAssignableUsers(getDb(), admin.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;

  const noticeMessage =
    notice === "saved"
      ? "Access saved."
      : notice === "removed"
        ? "Access removed."
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/dashboard/restaurants/${detail.restaurant.id}`}
        backLabel={detail.restaurant.name}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title="Restaurant access"
        description="Administrators always have full access. Grant each team member the narrowest set of permissions they need. View-only access is included whenever a member has access at all."
      />

      {noticeMessage ? <Notice tone="success">{noticeMessage}</Notice> : null}
      {error ? (
        <Notice tone="error">
          Access could not be saved. Check the user is active and try again.
        </Notice>
      ) : null}

      {users.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="h-6 w-6" aria-hidden="true" />}
          title="No active authorized users"
          description="Invite a team member first, then return here to grant restaurant access."
          action={
            <Link
              href="/dashboard/users"
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              Invite a user
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {users.map((member) => (
            <Card key={member.id}>
              <CardBody>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {member.name}
                      </p>
                      <Badge tone={member.hasAccess ? "success" : "neutral"}>
                        {member.hasAccess ? "Has access" : "No access"}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-zinc-600">
                      {member.email}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      Tick any combination. Every member with access can still
                      view the restaurant and its menus.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <form
                      action={setPermissionAction}
                      className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3"
                    >
                      <input
                        type="hidden"
                        name="restaurantId"
                        value={detail.restaurant.id}
                      />
                      <input type="hidden" name="userId" value={member.id} />
                      <div className="grid gap-3 sm:grid-cols-3">
                        {permissionOptions.map((option) => (
                          <label
                            key={option.name}
                            className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2.5 py-2 text-xs ring-1 ring-inset ring-zinc-200 transition hover:ring-amber-300"
                          >
                            <input
                              type="checkbox"
                              name={option.name}
                              defaultChecked={member.flags[option.name]}
                              className={checkboxClass}
                            />
                            <span>
                              <span className="block font-medium text-zinc-800">
                                {option.label}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">
                                {option.description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-zinc-500">
                          Changes apply immediately.
                        </p>
                        <button
                          type="submit"
                          className={buttonClass({
                            variant: "secondary",
                            size: "sm",
                          })}
                        >
                          Save access
                        </button>
                      </div>
                    </form>

                    {member.hasAccess ? (
                      <form action={removePermissionAction}>
                        <input
                          type="hidden"
                          name="restaurantId"
                          value={detail.restaurant.id}
                        />
                        <input type="hidden" name="userId" value={member.id} />
                        <ConfirmButton
                          message={`Remove all access for ${member.name}?`}
                          className={buttonClass({
                            variant: "danger",
                            size: "sm",
                          })}
                        >
                          Remove
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
