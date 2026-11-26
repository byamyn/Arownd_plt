import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { router, usePathname } from "expo-router";

import { BottomNavigation, Icon } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import { translate } from "@/lib/i18n";
import { getCustomerTab, reselectHome, type CustomerTab } from "@/lib/customer-navigation-state";
import { useAppTheme } from "@/lib/theme";

type NavigationTab = {
  id: Exclude<CustomerTab, "none"> | "orders" | "products" | "analytics" | "store";
  label: "navHome" | "navExplore" | "navMap" | "navCart" | "navAccount" | "merchantOrdersPageTitle" | "merchantProductsTitle" | "merchantAnalyticsTitle" | "merchantMyStore";
  icon: "home" | "search" | "map" | "shopping-bag" | "user" | "store" | "file-text" | "package" | "layout-grid";
  path: string;
};

const customerTabs: NavigationTab[] = [
  { id: "home", label: "navHome", icon: "home", path: "/home" },
  { id: "cart", label: "navCart", icon: "shopping-bag", path: "/cart" },
  { id: "map", label: "navMap", icon: "map", path: "/map" },
  { id: "profile", label: "navAccount", icon: "user", path: "/profile" }
];

export function CustomerNavigation() {
  const pathname = usePathname();
  const theme = useAppTheme();
  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });
  const isMerchantReady = access.data?.status === "merchant_ready";
  const isMerchantRoute = pathname.startsWith("/merchant");
  const ownedStoreId = access.data?.store?.id;
  const canViewAnalytics = access.data?.teamRole === "owner" || access.data?.teamRole === "admin";
  const canManageCatalog = canViewAnalytics;
  const isOwnStoreRoute = Boolean(ownedStoreId && pathname === `/store/${ownedStoreId}`);
  const useStudioNavigation = (isMerchantRoute || isOwnStoreRoute) && isMerchantReady;
  const studioTabs: NavigationTab[] = [
    { id: "orders", label: "merchantOrdersPageTitle", icon: "file-text", path: "/merchant/orders" },
    ...(canManageCatalog ? [{ id: "products" as const, label: "merchantProductsTitle" as const, icon: "package" as const, path: "/merchant/products" }] : []),
    ...(canViewAnalytics ? [{ id: "analytics" as const, label: "merchantAnalyticsTitle" as const, icon: "layout-grid" as const, path: "/merchant/analytics" }] : []),
    ...(ownedStoreId ? [{ id: "store" as const, label: "merchantMyStore" as const, icon: "store" as const, path: `/store/${ownedStoreId}` }] : [])
  ];
  const tabs = useStudioNavigation ? studioTabs : customerTabs;

  const studioTab: NavigationTab["id"] | null = isOwnStoreRoute
    ? "store"
    : pathname.startsWith("/merchant/orders")
      ? "orders"
      : pathname.startsWith("/merchant/products")
        ? "products"
        : pathname.startsWith("/merchant/analytics")
          ? "analytics"
          : pathname.startsWith("/merchant/settings") || pathname.startsWith("/merchant/account-settings") || pathname.startsWith("/merchant/verification") || pathname.startsWith("/merchant/team") || pathname.startsWith("/merchant/select-store")
            ? null
            : "orders";
  const activeTab = useStudioNavigation
    ? studioTab
    : isMerchantRoute || isOwnStoreRoute
      ? null
      : getCustomerTab(pathname);
  const selectedTab = activeTab;

  if (access.isPending || !activeTab) return null;

  return (
    <BottomNavigation
      accessibilityLabel={translate("navMain")}
      value={selectedTab === "none" ? "" : selectedTab ?? ""}
      onChange={(key) => {
        const destination = tabs.find((tab) => tab.id === key)?.path;
        if (destination && pathname === destination && key === "home") {
          reselectHome();
          return;
        }
        if (destination && pathname !== destination) router.replace(destination);
      }}
      items={tabs.map((tab) => {
        const selected = selectedTab === tab.id;
        return {
          key: tab.id,
          label: translate(tab.label),
          icon: (
            <View style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
              <Icon
                name={tab.icon}
                size={20}
                color={selected ? theme.colors.accentOnSurface : theme.colors.muted}
                fill="none"
                strokeWidth={selected ? 2.1 : 1.8}
                accessibilityHidden
              />
            </View>
          )
        };
      })}
    />
  );
}
