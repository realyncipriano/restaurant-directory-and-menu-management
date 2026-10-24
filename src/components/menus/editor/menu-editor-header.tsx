import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import type { MenuStatusTone } from "@/lib/menu-editor-view";

export function MenuEditorHeader({
  restaurantId,
  title,
  slug,
  version,
  status,
  statusTone,
}: {
  restaurantId: string;
  title: string;
  slug: string;
  version: number;
  status: string;
  statusTone: MenuStatusTone;
}) {
  return (
    <PageHeader
      backHref={`/dashboard/restaurants/${restaurantId}/menus`}
      backLabel="Menus"
      title={title}
      description={
        <span className="flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-500">
          /{slug}
          <span className="font-sans text-zinc-400">·</span>
          <span className="font-sans">Version {version}</span>
        </span>
      }
      actions={
        <Badge tone={statusTone} className="capitalize">
          {status}
        </Badge>
      }
    />
  );
}
