import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { router, usePathname } from "expo-router";

import { BottomNavigation, Icon, Text as UiText } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import { translate } from "@/lib/i18n";
import { getCustomerTab, type CustomerTab } from "@/lib/customer-navigation-state";
import { useAppTheme } from "@/lib/theme";
import { CART_QUERY_KEY, getCart } from "@/lib/cart";

type NavigationTab = {
  id: Exclude<CustomerTab, "none"> | "orders" | "products" | "analytics" | "store";
  label: "navHome" | "navExplore" | "navMap" | "navCart" | "navAccount" | "merchantOrdersPageTitle" | "merchantProductsTitle" | "merchantAnalyticsTitle" | "merchantMyStore";
  icon: "home" | "search" | "map" | "shopping-cart" | "user" | "store" | "file-text" | "package" | "layout-grid";
  path: string;
};

const customerTabs: NavigationTab[] = [
  { id: "home", label: "navHome", icon: "home", path: "/home" },
  { id: "explore", label: "navExplore", icon: "search", path: "/explore" },
  { id: "map", label: "navMap", icon: "map", path: "/map" },
  { id: "cart", label: "navCart", icon: "shopping-cart", path: "/cart" },
  { id: "profile", label: "navAccount", icon: "user", path: "/profile" }
];

export function CustomerNavigation() {
  const pathname = usePathname();
  const theme = useAppTheme();
  const cart = useQuery({ queryKey: CART_QUERY_KEY, queryFn: getCart });
  const cartCount = cart.data?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: fetchMerchantAccess,
    retry: false
  });
  const isMerchantReady = access.data?.status === "merchant_ready";
  const isMerchantRoute = pathname.startsWith("/merchant");
  const ownedStoreId = access.data?.store?.id;
  const isOwnStoreRoute = Boolean(ownedStoreId && pathname === `/store/${ownedStoreId}`);
  const useStudioNavigation = (isMerchantRoute || isOwnStoreRoute) && isMerchantReady;
  const studioTabs: NavigationTab[] = [
    { id: "orders", label: "merchantOrdersPageTitle", icon: "file-text", path: "/merchant/orders" },
    { id: "products", label: "merchantProductsTitle", icon: "package", path: "/merchant/products" },
    { id: "analytics", label: "merchantAnalyticsTitle", icon: "layout-grid", path: "/merchant/analytics" },
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
          : pathname.startsWith("/merchant/settings") || pathname.startsWith("/merchant/account-settings") || pathname.startsWith("/merchant/verification")
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
        if (destination && pathname !== destination) router.replace(destination);
      }}
      items={tabs.map((tab) => {
        const selected = selectedTab === tab.id;
        return {
          key: tab.id,
          label: translate(tab.label),
          icon: (
            <View style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}>
              <Icon
                name={tab.icon}
                size={22}
                color={selected ? theme.colors.accent : theme.colors.muted}
                fill="none"
                strokeWidth={selected ? 2.1 : 1.8}
                accessibilityHidden
              />
              {tab.id === "cart" && cartCount > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    end: -5,
                    minWidth: 17,
                    height: 17,
                    paddingHorizontal: 4,
                    borderRadius: theme.radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.accent
                  }}
                >
                  <UiText style={{ color: theme.colors.accentForeground, fontSize: 9, fontWeight: theme.fontWeights.extrabold, fontVariant: ["tabular-nums"] }}>
                    {cartCount > 99 ? "99+" : cartCount}
                  </UiText>
                </View>
              ) : null}
            </View>
          )
        };
      })}
    />
  );
}
