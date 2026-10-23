import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));

import {
  revalidateImportPaths,
  revalidateMenuPaths,
  revalidateRestaurantAccess,
  revalidateRestaurantDetail,
  revalidateRestaurantList,
} from "@/lib/revalidate";

describe("dashboard revalidation helpers", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it("revalidates restaurant list and detail paths", () => {
    revalidateRestaurantList();
    revalidateRestaurantDetail("restaurant-1");
    revalidateRestaurantAccess("restaurant-1");

    expect(revalidatePath.mock.calls).toEqual([
      ["/dashboard/restaurants"],
      ["/dashboard/restaurants/restaurant-1"],
      ["/dashboard/restaurants/restaurant-1/access"],
    ]);
  });

  it("revalidates menu paths with and without a menu id", () => {
    revalidateMenuPaths("restaurant-1");
    revalidateMenuPaths("restaurant-1", "menu-1");

    expect(revalidatePath.mock.calls).toEqual([
      ["/dashboard/restaurants"],
      ["/dashboard/restaurants/restaurant-1"],
      ["/dashboard/restaurants/restaurant-1/menus"],
      ["/dashboard/restaurants"],
      ["/dashboard/restaurants/restaurant-1"],
      ["/dashboard/restaurants/restaurant-1/menus"],
      ["/dashboard/restaurants/restaurant-1/menus/menu-1"],
    ]);
  });

  it("revalidates import paths with and without an import id", () => {
    revalidateImportPaths("restaurant-1");
    revalidateImportPaths("restaurant-1", "import-1");

    expect(revalidatePath.mock.calls).toEqual([
      ["/dashboard/restaurants/restaurant-1"],
      ["/dashboard/restaurants/restaurant-1/imports"],
      ["/dashboard/restaurants/restaurant-1"],
      ["/dashboard/restaurants/restaurant-1/imports"],
      ["/dashboard/restaurants/restaurant-1/imports/import-1"],
    ]);
  });
});
