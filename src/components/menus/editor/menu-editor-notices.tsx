import { Notice } from "@/components/ui/notice";

export function MenuEditorNotices({
  noticeMessage,
  errorMessage,
  restaurantActive,
  restaurantName,
}: {
  noticeMessage: string | null;
  errorMessage: string | null;
  restaurantActive: boolean;
  restaurantName: string;
}) {
  return (
    <>
      {noticeMessage ? <Notice tone="success">{noticeMessage}</Notice> : null}
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {!restaurantActive ? (
        <Notice tone="warning" title={`${restaurantName} is archived`}>
          Reactivate it from the restaurant page before editing or publishing
          menus.
        </Notice>
      ) : null}
    </>
  );
}
