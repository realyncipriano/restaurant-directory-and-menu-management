import { History } from "lucide-react";
import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

type MenuHistoryVersion = {
  id: string;
  version: number;
  status: string;
  updatedAt: Date;
};

type MenuHistoryChange = {
  id: string;
  action: string;
  createdAt: Date;
};

export function MenuHistoryCards({
  restaurantId,
  currentMenuId,
  versions,
  changes,
}: {
  restaurantId: string;
  currentMenuId: string;
  versions: MenuHistoryVersion[];
  changes: MenuHistoryChange[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardBody>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <History className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Version history
          </h2>
          <ul className="mt-3 divide-y divide-zinc-100">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/dashboard/restaurants/${restaurantId}/menus/${version.id}`}
                  className={
                    version.id === currentMenuId
                      ? "font-semibold text-zinc-900"
                      : "text-zinc-600 hover:text-amber-800"
                  }
                >
                  Version {version.version}
                  {version.status === "published"
                    ? " · published"
                    : version.status === "draft"
                      ? " · draft"
                      : " · archived"}
                </Link>
                <span className="text-xs text-zinc-400">
                  {dateFormatter.format(version.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-sm font-semibold text-zinc-900">
            Recorded changes
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Changes are recorded when this version is published.
          </p>
          {changes.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No recorded changes.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {changes.slice(0, 12).map((change) => (
                <li key={change.id} className="text-xs text-zinc-600">
                  <span className="font-medium capitalize text-zinc-800">
                    {change.action.replaceAll("_", " ")}
                  </span>
                  {" · "}
                  {dateFormatter.format(change.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
