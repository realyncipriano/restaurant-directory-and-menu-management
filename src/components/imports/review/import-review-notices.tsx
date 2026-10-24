import { Notice } from "@/components/ui/notice";
import type { ImportReviewNotice } from "@/lib/import-review-view";

export function ImportReviewNotices({
  notices,
}: {
  notices: readonly ImportReviewNotice[];
}) {
  return (
    <>
      {notices.map((notice) => (
        <Notice key={notice.key} tone={notice.tone} title={notice.title}>
          {notice.message}
        </Notice>
      ))}
    </>
  );
}
