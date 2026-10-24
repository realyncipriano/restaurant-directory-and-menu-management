import { describe, expect, it } from "vitest";

import {
  buildImportReviewNotices,
  type ImportReviewNoticeInput,
} from "@/lib/import-review-view";

function noticeInput(
  overrides: Partial<ImportReviewNoticeInput> = {},
): ImportReviewNoticeInput {
  return {
    selectedCategoryMissing: false,
    failedMessage: null,
    extractionConfigured: true,
    canEdit: true,
    status: "needs_review",
    ...overrides,
  };
}

describe("import review notices", () => {
  it("builds the accepted notice", () => {
    expect(
      buildImportReviewNotices(noticeInput({ notice: "accepted" })),
    ).toEqual([
      {
        key: "accepted",
        tone: "success",
        message:
          "Confident, priced items were accepted. Review the remaining items before applying.",
      },
    ]);
  });

  it("builds category-accepted notices with singular and remaining counts", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          notice: "category-accepted",
          accepted: 1,
          pendingInCategory: 2,
          selectedCategoryParam: "Coffee",
        }),
      ),
    ).toEqual([
      {
        key: "category-accepted",
        tone: "success",
        message:
          "Accepted 1 pending item in “Coffee”. 2 items in this category still need review.",
      },
    ]);
  });

  it("uses the active category as the category notice fallback", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          notice: "category-accepted",
          accepted: 0,
          pendingInCategory: 0,
          activeCategoryName: "Tea",
        }),
      ),
    ).toEqual([
      {
        key: "category-accepted",
        tone: "success",
        message:
          "Accepted 0 pending items in “Tea”. No items remain pending in this category.",
      },
    ]);
  });

  it("prefers the raw selected category value for notices", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          notice: "category-rejected",
          rejected: 1,
          pending: 2,
          selectedCategoryParam: "  Missing Category  ",
          activeCategoryName: "Coffee",
          selectedCategoryMissing: true,
        }),
      )[0],
    ).toEqual({
      key: "category-rejected",
      tone: "success",
      message:
        "Rejected 1 pending item in “  Missing Category  ”. 2 items remain pending across this scan.",
    });
  });

  it("builds the category-rejected notice", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          notice: "category-rejected",
          rejected: 2,
          pending: 1,
          activeCategoryName: "Coffee",
        }),
      ),
    ).toEqual([
      {
        key: "category-rejected",
        tone: "success",
        message:
          "Rejected 2 pending items in “Coffee”. 1 item remain pending across this scan.",
      },
    ]);
  });

  it("builds the keep-only notice with exact counts", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          notice: "keep-only",
          accepted: 1,
          rejected: 2,
          pending: 1,
          activeCategoryName: "Coffee",
        }),
      ),
    ).toEqual([
      {
        key: "keep-only",
        tone: "success",
        message:
          "Kept only “Coffee”. Accepted 1 item and moved 2 to rejected. 1 item remain pending for manual review.",
      },
    ]);
  });

  it("builds both action error notices", () => {
    expect(
      buildImportReviewNotices(noticeInput({ error: "accept" })),
    ).toEqual([
      {
        key: "accept-error",
        tone: "error",
        message: "Items could not be accepted. Please try again.",
      },
    ]);
    expect(
      buildImportReviewNotices(noticeInput({ error: "category" })),
    ).toEqual([
      {
        key: "category-error",
        tone: "error",
        message:
          "The category action could not be completed. No item decisions were changed.",
      },
    ]);
  });

  it("builds missing, failed, extraction, and read-only notices in order", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          selectedCategoryMissing: true,
          failedMessage: "Provider failed.",
          extractionConfigured: false,
          canEdit: false,
          status: "failed",
        }),
      ),
    ).toEqual([
      {
        key: "category-missing",
        tone: "warning",
        message:
          "That category is no longer present in this scan. Showing all categories instead.",
      },
      {
        key: "failed",
        tone: "error",
        message: "Provider failed.",
      },
      {
        key: "extraction-unconfigured",
        tone: "warning",
        title: "Menu extraction is not configured",
        message:
          "Add an extraction provider and API key to process this scan, or continue with manual menu entry.",
      },
      {
        key: "read-only",
        tone: "info",
        message: "You have read-only access to this scan review.",
      },
    ]);
  });

  it("hides extraction and failed notices when their conditions do not apply", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({
          failedMessage: "Provider failed.",
          extractionConfigured: false,
          status: "applied",
        }),
      ),
    ).toEqual([]);
  });

  it("ignores unknown notice and error values", () => {
    expect(
      buildImportReviewNotices(
        noticeInput({ notice: "unknown", error: "unknown" }),
      ),
    ).toEqual([]);
  });
});
