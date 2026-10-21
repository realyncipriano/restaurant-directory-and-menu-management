"use client";

import { useActionState } from "react";

import { updateImportItemAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";
import { formatMinorForInput, formatPrice } from "@/lib/money";

const changeLabels: Record<string, string> = {
  new: "New item",
  price_changed: "Price changed",
  description_changed: "Description changed",
  availability_changed: "Availability changed",
  unchanged: "Unchanged",
};

export type ReviewItem = {
  id: string;
  pageNumber: number | null;
  categoryName: string;
  name: string;
  description: string | null;
  basePriceMinor: number | null;
  currency: string;
  variants: { name: string; priceMinor: number | null }[];
  modifiers: {
    name: string;
    additionalPriceMinor: number | null;
    isAvailable: boolean;
  }[];
  availabilityStatus: "available" | "unavailable";
  confidence: number | null;
  needsReview: boolean;
  changeType: string;
  decision: "pending" | "accept" | "reject";
  duplicateName: string | null;
};

export function ImportItemReviewForm({
  restaurantId,
  importId,
  item,
}: {
  restaurantId: string;
  importId: string;
  item: ReviewItem;
}) {
  const [state, formAction, pending] = useActionState(
    updateImportItemAction,
    EMPTY_FORM_STATE,
  );

  const decisionStyles =
    item.decision === "accept"
      ? "border-emerald-300 bg-emerald-50/60"
      : item.decision === "reject"
        ? "border-zinc-200 bg-zinc-50 opacity-70"
        : "border-zinc-200 bg-white";

  return (
    <form
      action={formAction}
      className={`rounded-xl border p-4 ${decisionStyles}`}
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="itemId" value={item.id} />

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
          {changeLabels[item.changeType] ?? item.changeType}
        </span>
        <span
          className={
            (item.confidence ?? 0) < 70
              ? "rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700"
              : "rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
          }
        >
          {item.confidence ?? "?"}% confidence
        </span>
        {item.pageNumber ? (
          <span className="text-zinc-400">Page {item.pageNumber}</span>
        ) : null}
        {item.duplicateName ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
            Possible duplicate of “{item.duplicateName}”
          </span>
        ) : null}
        <span className="ml-auto font-medium capitalize text-zinc-500">
          {item.decision}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-zinc-700">
          Category
          <input
            name="categoryName"
            defaultValue={item.categoryName}
            required
            maxLength={120}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-700">
          Item name
          <input
            name="name"
            defaultValue={item.name}
            required
            maxLength={160}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-700 sm:col-span-2">
          Description
          <textarea
            name="description"
            defaultValue={item.description ?? ""}
            rows={2}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-700">
          Base price ({item.currency})
          <input
            name="basePrice"
            defaultValue={formatMinorForInput(item.basePriceMinor)}
            inputMode="decimal"
            placeholder="e.g. 185.00"
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-700">
          Availability
          <select
            name="availabilityStatus"
            defaultValue={item.availabilityStatus}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          >
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
      </div>

      {item.variants.length > 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          Variants:{" "}
          {item.variants
            .map(
              (variant) =>
                `${variant.name} ${formatPrice(variant.priceMinor, item.currency)}`,
            )
            .join(" · ")}
        </p>
      ) : null}
      {item.modifiers.length > 0 ? (
        <p className="mt-1 text-xs text-zinc-400">
          Add-ons:{" "}
          {item.modifiers
            .map(
              (modifier) =>
                `${modifier.name} +${formatPrice(modifier.additionalPriceMinor, item.currency)}`,
            )
            .join(" · ")}
        </p>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {state.success}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="pending"
          disabled={pending}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          Save edits
        </button>
        <button
          type="submit"
          name="decision"
          value="accept"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Accept
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          Reject
        </button>
      </div>
    </form>
  );
}
