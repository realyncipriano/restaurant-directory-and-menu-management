import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateRestaurantList(): void {
  revalidatePath("/dashboard/restaurants");
}

export function revalidateRestaurantDetail(restaurantId: string): void {
  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
}

export function revalidateRestaurantAccess(restaurantId: string): void {
  revalidatePath(`/dashboard/restaurants/${restaurantId}/access`);
}

export function revalidateMenuPaths(
  restaurantId: string,
  menuId?: string,
): void {
  revalidatePath("/dashboard/restaurants");
  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
  revalidatePath(`/dashboard/restaurants/${restaurantId}/menus`);
  if (menuId) {
    revalidatePath(
      `/dashboard/restaurants/${restaurantId}/menus/${menuId}`,
    );
  }
}

export function revalidateImportPaths(
  restaurantId: string,
  importId?: string,
): void {
  revalidatePath(`/dashboard/restaurants/${restaurantId}`);
  revalidatePath(`/dashboard/restaurants/${restaurantId}/imports`);
  if (importId) {
    revalidatePath(
      `/dashboard/restaurants/${restaurantId}/imports/${importId}`,
    );
  }
}
