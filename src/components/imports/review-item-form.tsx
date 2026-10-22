"use client";

import { useActionState, useState } from "react";

import { updateImportItemAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  const [intent, setIntent] = useState<"save" | "accept" | "reject" | null>(
    null,
  );
  const decided = item.decision !== "pending";
  const lowConfidence = (item.confidence ?? 0) < 70;

  const decisionStyles =
    item.decision === "accept"
      ? "border-emerald-300 bg-emerald-50/50"
      : item.decision === "reject"
        ? "border-zinc-200 bg-zinc-50 opacity-70"
        : "border-zinc-200 bg-white";

  return (
    <form
      action={formAction}
      className={`rounded-2xl border p-4 shadow-sm transition ${decisionStyles}`}
      aria-busy={pending}
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="itemId" value={item.id} />

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge tone="neutral">
          {changeLabels[item.changeType] ?? item.changeType}
        </Badge>
        <Badge tone={lowConfidence ? "danger" : "success"}>
          {item.confidence ?? "?"}% confidence
        </Badge>
        {item.pageNumber ? (
          <span className="text-zinc-400">Page {item.pageNumber}</span>
        ) : null}
        {item.duplicateName ? (
          <Badge tone="warning">
            Possible duplicate of “{item.duplicateName}”
          </Badge>
        ) : null}
        <Badge
          tone={
            item.decision === "accept"
              ? "success"
              : item.decision === "reject"
                ? "neutral"
                : "warning"
          }
          className="ml-auto"
        >
          {item.decision}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          id={`review-category-${item.id}`}
          label="Category"
          note="Groups this item on the menu."
          noteLayout="below"
          required
          error={state.fieldErrors?.categoryName?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="categoryName"
              defaultValue={item.categoryName}
              maxLength={120}
            />
          )}
        </Field>
        <Field
          id={`review-name-${item.id}`}
          label="Item name"
          note="Shown to guests on the public menu."
          noteLayout="below"
          required
          error={state.fieldErrors?.name?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              defaultValue={item.name}
              maxLength={160}
            />
          )}
        </Field>
        <Field
          id={`review-description-${item.id}`}
          label="Description"
          note="Optional details from the scan. Edit anything that looks misread."
          noteLayout="below"
          optional
          error={state.fieldErrors?.description?.[0]}
          className="sm:col-span-2"
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              defaultValue={item.description ?? ""}
              rows={2}
            />
          )}
        </Field>
        <Field
          id={`review-price-${item.id}`}
          label={`Base price (${item.currency})`}
          note="Leave blank when every serving has its own variant price."
          noteLayout="below"
          error={state.fieldErrors?.basePrice?.[0]}
        >
          {(control) => (
            <Input
              {...control}
              name="basePrice"
              defaultValue={formatMinorForInput(item.basePriceMinor)}
              inputMode="decimal"
              placeholder="e.g. 185.00"
            />
          )}
        </Field>
        <Field
          id={`review-availability-${item.id}`}
          label="Availability"
          note="Unavailable items stay listed but are marked to guests."
          noteLayout="below"
          error={state.fieldErrors?.availabilityStatus?.[0]}
        >
          {(control) => (
            <Select
              {...control}
              name="availabilityStatus"
              defaultValue={item.availabilityStatus}
            >
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </Select>
          )}
        </Field>
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
        <Notice tone="error" className="mt-3">
          {state.error}
        </Notice>
      ) : null}
      {state.success ? (
        <Notice tone="success" className="mt-3">
          {state.success}
        </Notice>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
        <Button
          type="submit"
          name="decision"
          value="pending"
          variant="outline"
          size="sm"
          isLoading={pending && (intent === "save" || intent === null)}
          loadingLabel="Saving..."
          onClick={() => setIntent("save")}
          disabled={pending}
        >
          Save edits
        </Button>
        <Button
          type="submit"
          name="decision"
          value="accept"
          variant="success"
          size="sm"
          isLoading={pending && intent === "accept"}
          loadingLabel="Accepting..."
          onClick={() => setIntent("accept")}
          disabled={pending || decided}
        >
          Accept
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="danger"
          size="sm"
          isLoading={pending && intent === "reject"}
          loadingLabel="Rejecting..."
          onClick={() => setIntent("reject")}
          disabled={pending || decided}
        >
          Reject
        </Button>
      </div>
    </form>
  );
}
