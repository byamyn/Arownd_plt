export type CustomerTab = "home" | "explore" | "map" | "profile" | "none";

export function getCustomerTab(pathname: string): CustomerTab | null {
  if (pathname === "/home" || pathname === "/") return "home";
  if (pathname === "/explore" || pathname.startsWith("/product/")) return "explore";
  if (pathname === "/map") return "map";
  if (pathname === "/cart") return "none";
  if (
    pathname === "/stores" ||
    pathname.startsWith("/store/") ||
    pathname === "/favorites"
  ) return "none";
  if (
    pathname === "/profile" ||
    pathname === "/settings" ||
    pathname === "/delivery-profile" ||
    pathname === "/addresses" ||
    pathname === "/invite" ||
    pathname === "/notifications" ||
    pathname === "/my-reviews" ||
    pathname === "/orders" ||
    pathname.startsWith("/orders/")
  ) return "profile";
  if (pathname === "/checkout") return null;
  return null;
}

let homeReselectHandler: (() => void) | null = null;

export function registerHomeReselectHandler(handler: () => void): () => void {
  homeReselectHandler = handler;
  return () => {
    if (homeReselectHandler === handler) homeReselectHandler = null;
  };
}

export function reselectHome(): void {
  homeReselectHandler?.();
}
