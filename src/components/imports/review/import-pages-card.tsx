import { ScanLine } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";

type ImportPagePreview = {
  id: string;
  pageNumber: number;
  processingStatus: string;
};

export function ImportPagesCard({
  restaurantId,
  importId,
  pages,
}: {
  restaurantId: string;
  importId: string;
  pages: readonly ImportPagePreview[];
}) {
  return (
    <Card>
      <CardHeader
        icon={<ScanLine className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
        title="Uploaded pages"
        description="Private previews are served through authorized, short-lived signed links."
      />
      <CardBody>
        <div className="grid gap-3 sm:grid-cols-2">
          {pages.map((page) => (
            <a
              key={page.id}
              href={`/dashboard/restaurants/${restaurantId}/imports/${importId}/pages/${page.id}`}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 transition hover:border-amber-300 hover:shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/dashboard/restaurants/${restaurantId}/imports/${importId}/pages/${page.id}`}
                alt={`Menu page ${page.pageNumber}`}
                className="h-48 w-full object-contain"
                loading="lazy"
              />
              <p className="bg-white px-3 py-2 text-xs text-zinc-500">
                Page {page.pageNumber} ·{" "}
                <span className="capitalize">{page.processingStatus}</span>
              </p>
            </a>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
