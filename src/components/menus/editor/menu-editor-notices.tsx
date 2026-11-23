import { Notice } from "@/components/ui/notice";

export function MenuEditorNotices({
  noticeMessage,
  errorMessage,
  restaurantActive,
  restaurantName,
  deleted,
}: {
  noticeMessage: string | null;
  errorMessage: string | null;
  restaurantActive: boolean;
  restaurantName: string;
  deleted: boolean;
}) {
  return (
    <>
      {noticeMessage ? <Notice tone="success">{noticeMessage}</Notice> : null}
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {deleted ? (
        <Notice tone="warning" title="This menu was deleted">
          It is hidden from the menus list and public pages. Its versions,
          items, and history are retained for reference.
        </Notice>
      ) : null}
      {!restaurantActive ? (
        <Notice tone="warning" title={`${restaurantName} is archived`}>
          Reactivate it from the restaurant page before editing or publishing
          menus.
        </Notice>
      ) : null}
    </>
  );
}
