"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  beginImportAction,
  confirmImportAction,
} from "@/app/dashboard/restaurants/[id]/imports/actions";

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooMany = fileCount > maxPages;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    setPending(true);
    setError(null);
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
        return;
      }

      for (const upload of begin.result.uploads) {
        const file = files[upload.pageNumber - 1];
        if (!file) throw new Error("A selected page is missing.");
        const response = await fetch(upload.url, {
          method: "PUT",
          headers: { "Content-Type": upload.contentType },
          body: file,
        });
        if (!response.ok) {
          throw new Error("A scan page could not be uploaded.");
        }
      }

      const confirmed = await confirmImportAction({
        restaurantId,
        importId: begin.result.importId,
      });
      if (confirmed.error) {
        setError(confirmed.error);
        return;
      }

      router.push(
        `/dashboard/restaurants/${restaurantId}/imports/${begin.result.importId}`,
      );
    } catch {
      setError(
        "The scan pages could not be uploaded. Check storage CORS settings and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (menuOptions.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Create a draft menu first. Scans are applied to a draft so published
        menus are never changed directly.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <label className="block text-sm font-medium text-zinc-800">
        Apply scan to draft menu
        <select
          name="menuId"
          required
          className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        >
          {menuOptions.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.title}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-zinc-800">
        Menu page images
        <input
          type="file"
          name="pages"
          accept="image/jpeg,image/png,image/webp"
          multiple
          required
          onChange={(event) => setFileCount(event.target.files?.length ?? 0)}
          className="mt-1 block w-full cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
        />
      </label>
      <p className="text-xs leading-5 text-zinc-500">
        JPEG, PNG, or WebP. Up to {maxPages} pages, 8 MB each. Uploads stay
        private; only signed page previews are shown to authorized users.
      </p>
      {fileCount > 0 ? (
        <p
          className={
            tooMany
              ? "text-xs font-medium text-red-600"
              : "text-xs text-zinc-500"
          }
        >
          {fileCount} page{fileCount === 1 ? "" : "s"} selected.
        </p>
      ) : null}

      {!storageConfigured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Scan uploads are disabled until the R2 storage credentials are
          configured.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !storageConfigured || tooMany}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Uploading..." : "Upload scan pages"}
      </button>
    </form>
  );
}
