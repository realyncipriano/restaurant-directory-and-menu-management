"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  beginImportAction,
  confirmImportAction,
} from "@/app/dashboard/restaurants/[id]/imports/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FileInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type UploadPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "verifying"
  | "opening";

function uploadFileWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error("A scan page could not be uploaded."));
      }
    });
    request.addEventListener("error", () => {
      reject(new Error("A scan page could not be uploaded."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The upload was cancelled."));
    });
    request.send(file);
  });
}

export function StartImportForm({
  restaurantId,
  menuOptions,
  storageConfigured,
  maxPages,
}: {
  restaurantId: string;
  menuOptions: { id: string; title: string }[];
  storageConfigured: boolean;
  maxPages: number;
}) {
  const router = useRouter();
  const [fileCount, setFileCount] = useState(0);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [totalPages, setTotalPages] = useState(0);
  const [completedPages, setCompletedPages] = useState(0);
  const [currentPercent, setCurrentPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, startTransition] = useTransition();
  const tooMany = fileCount > maxPages;
  const busy = phase !== "idle" || isNavigating;
  const overallPercent =
    totalPages > 0
      ? Math.min(
          100,
          Math.round(
            ((completedPages + currentPercent / 100) / totalPages) * 100,
          ),
        )
      : 0;
  const activePage =
    totalPages > 0 ? Math.min(completedPages + 1, totalPages) : 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const formData = new FormData(event.currentTarget);
    const menuId = String(formData.get("menuId") ?? "");
    const files = formData
      .getAll("pages")
      .filter((file): file is File => file instanceof File);

    if (!menuId) {
      setError("Choose a draft menu first.");
      return;
    }
    if (files.length === 0) {
      setError("Choose at least one menu image to scan.");
      return;
    }

    setError(null);
    setPhase("preparing");
    setTotalPages(files.length);
    setCompletedPages(0);
    setCurrentPercent(0);
    try {
      const begin = await beginImportAction({
        restaurantId,
        menuId,
        files: files.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
        })),
      });
      if (begin.error || !begin.result) {
        setError(begin.error ?? "The upload could not start.");
        setPhase("idle");
        return;
      }

      const startedImport = begin.result;
      const importId = startedImport.importId;
      setPhase("uploading");
      for (const [index, upload] of startedImport.uploads.entries()) {
        const file = files[upload.pageNumber - 1];
        if (!file) throw new Error("A selected page is missing.");
        setCompletedPages(index);
        setCurrentPercent(0);
        await uploadFileWithProgress(
          upload.url,
          file,
          upload.contentType,
          setCurrentPercent,
        );
        setCompletedPages(index + 1);
        setCurrentPercent(0);
      }

      setPhase("verifying");
      const confirmed = await confirmImportAction({
        restaurantId,
        importId,
      });
      if (confirmed.error) {
        setError(confirmed.error);
        setPhase("idle");
        return;
      }

      setPhase("opening");
      startTransition(() => {
        router.push(
          `/dashboard/restaurants/${restaurantId}/imports/${importId}`,
        );
      });
    } catch {
      setError(
        "The scan pages could not be uploaded. Check storage CORS settings and try again.",
      );
      setPhase("idle");
      setTotalPages(0);
      setCompletedPages(0);
      setCurrentPercent(0);
    }
  }

  if (menuOptions.length === 0) {
    return (
      <Notice tone="warning">
        Create a draft menu first. Scans are applied to a draft so published
        menus are never changed directly.
      </Notice>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-busy={busy}>
      <input type="hidden" name="restaurantId" value={restaurantId} />

      <Field
        id="import-menu"
        label="Apply scan to draft menu"
        note="All section headings are extracted as categories in this menu. Scans always land in a draft first; during review you can accept, reject, or keep only one category."
        noteLayout="below"
        required
      >
        {(control) => (
          <Select {...control} name="menuId" disabled={busy}>
            {menuOptions.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.title}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="import-pages"
        label="Menu page images"
        note={`JPEG, PNG, or WebP. Up to ${maxPages} pages, 8 MB each. Uploads stay private; only signed previews are shown to authorized users.`}
        noteLayout="below"
        required
      >
        {(control) => (
          <FileInput
            {...control}
            type="file"
            name="pages"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(event) => setFileCount(event.target.files?.length ?? 0)}
          />
        )}
      </Field>

      {fileCount > 0 ? (
        <p
          className={
            tooMany
              ? "text-xs font-medium text-red-600"
              : "text-xs text-zinc-500"
          }
        >
          {fileCount} page{fileCount === 1 ? "" : "s"} selected
          {tooMany ? ` — the limit is ${maxPages}.` : "."}
        </p>
      ) : null}

      {!storageConfigured ? (
        <Notice tone="warning">
          Scan uploads are disabled until the R2 storage credentials are
          configured.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {busy ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-sm text-sky-900"
        >
          <div className="flex items-center gap-2">
            <Spinner className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              {phase === "preparing"
                ? "Preparing upload..."
                : phase === "uploading"
                  ? `Uploading page ${activePage} of ${totalPages} — ${currentPercent}%`
                  : phase === "verifying"
                    ? "Verifying uploaded images..."
                    : "Opening scan review..."}
            </span>
          </div>
          {phase === "uploading" ? (
            <>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-200"
                role="progressbar"
                aria-label="Scan upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overallPercent}
              >
                <div
                  className="h-full rounded-full bg-sky-600 transition-[width] duration-200"
                  style={{ width: `${overallPercent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-sky-700">
                {overallPercent}% uploaded
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      <Button
        type="submit"
        variant="secondary"
        disabled={!storageConfigured || tooMany}
        isLoading={busy}
        loadingLabel="Uploading..."
      >
        Upload scan pages
      </Button>
    </form>
  );
}
