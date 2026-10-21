import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import {
  removePermissionAction,
  setPermissionAction,
} from "@/app/dashboard/restaurants/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
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
  "h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-600";

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
      <div>
        <Link
          href={`/dashboard/restaurants/${detail.restaurant.id}`}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← {detail.restaurant.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Restaurant access
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
          Administrators always have full access. Grant each team member the
          narrowest set of permissions they need. View-only access is included
          whenever a member has access at all.
        </p>
      </div>

      {noticeMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {noticeMessage}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Access could not be saved. Check the user is active and try again.
        </p>
      ) : null}

      {users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <UserPlus
            className="mx-auto h-8 w-8 text-zinc-400"
            aria-hidden="true"
          />
          <h2 className="mt-3 text-sm font-semibold text-zinc-900">
            No active authorized users
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
            Invite a team member first, then return here to grant restaurant
            access.
          </p>
          <Link
            href="/dashboard/users"
            className="mt-4 inline-block text-sm font-medium text-amber-700 hover:text-amber-800"
          >
            Invite a user
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((member) => (
            <div
              key={member.id}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {member.name}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        member.hasAccess
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : "bg-zinc-100 text-zinc-600 ring-zinc-500/20"
                      }`}
                    >
                      {member.hasAccess ? "Has access" : "No access"}
                    </span>
                  </div>
                  <p className="truncate text-sm text-zinc-600">{member.email}</p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <form
                    action={setPermissionAction}
                    className="flex flex-wrap items-center gap-4"
                  >
                    <input type="hidden" name="restaurantId" value={detail.restaurant.id} />
                    <input type="hidden" name="userId" value={member.id} />
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700">
                      <input
                        type="checkbox"
                        name="canEditMenu"
                        defaultChecked={member.flags.canEditMenu}
                        className={checkboxClass}
                      />
                      Edit menus
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700">
                      <input
                        type="checkbox"
                        name="canPublishMenu"
                        defaultChecked={member.flags.canPublishMenu}
                        className={checkboxClass}
                      />
                      Publish
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700">
                      <input
                        type="checkbox"
                        name="canManageRestaurant"
                        defaultChecked={member.flags.canManageRestaurant}
                        className={checkboxClass}
                      />
                      Manage profile
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
                    >
                      Save
                    </button>
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
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Remove
                      </ConfirmButton>
                    </form>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
