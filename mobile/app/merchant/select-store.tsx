import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Alert, AppHeader, Card, Icon, PressableSurface, Spinner, StatusBadge, Text as UiText } from "@/components/ui";
import { fetchMerchantAccess, setActiveMerchantStoreId } from "@/lib/merchant";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

export default function MerchantSelectStoreScreen() {
  useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState(false);

  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });

  const selectStore = async (storeId: string) => {
    if (storeId === access.data?.store?.id) {
      router.replace("/merchant/orders");
      return;
    }
    setPendingStoreId(storeId);
    setSelectionError(false);
    try {
      await setActiveMerchantStoreId(storeId);
      await queryClient.invalidateQueries({ queryKey: ["merchant-access"] });
      router.replace("/merchant/orders");
    } catch {
      setSelectionError(true);
      setPendingStoreId(null);
    }
  };

  if (access.isPending) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}><View style={styles.center}><Spinner size="large" /></View></SafeAreaView>;
  }
  if (access.isError) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}><View style={styles.center}><Alert description={translate("merchantLoadError")} tone="danger" /></View></SafeAreaView>;
  }
  if (!access.data) return <Redirect href="/login" />;
  if (!access.data.stores.length) return <Redirect href="/merchant" />;

  const roleLabel = (role: "owner" | "admin" | "staff") =>
    role === "owner" ? translate("merchantTeamRoleOwner") : role === "admin" ? translate("merchantTeamRoleAdmin") : translate("merchantTeamRoleStaff");

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader title={translate("merchantSelectStoreTitle")} onBack={() => router.back()} />
        <UiText style={styles.subtitle}>{translate("merchantSelectStoreSubtitle")}</UiText>
        {selectionError ? <Alert description={translate("merchantSelectStoreError")} tone="danger" /> : null}
        <Card contentStyle={styles.list}>
          {access.data.stores.map((store, index) => {
            const selected = store.id === access.data.store?.id;
            const busy = pendingStoreId === store.id;
            return (
              <PressableSurface
                key={store.id}
                accessibilityRole="button"
                accessibilityLabel={store.name}
                disabled={pendingStoreId !== null}
                onPress={() => void selectStore(store.id)}
                style={[styles.storeRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }]}
              >
                <View style={[styles.storeIcon, { backgroundColor: theme.colors.surfaceSecondary }]}>
                  <Icon name="store" size={20} color={theme.colors.accentOnSurface} />
                </View>
                <View style={styles.storeCopy}>
                  <UiText weight="700" numberOfLines={1}>{store.name}</UiText>
                  <UiText style={styles.muted}>{roleLabel(store.role)}</UiText>
                </View>
                {busy ? <Spinner /> : selected ? <StatusBadge label={translate("merchantSelectStoreCurrent")} tone="accent" /> : <Icon name="chevron-left" size={18} color={theme.colors.subtle} />}
              </PressableSurface>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.xl, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.lg },
    subtitle: { color: theme.colors.muted, fontSize: theme.typography.caption + 1, lineHeight: 20 },
    list: { padding: 0, gap: 0 },
    storeRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.md },
    storeIcon: { width: 42, height: 42, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
    storeCopy: { flex: 1, minWidth: 0, gap: 4 },
    muted: { color: theme.colors.muted, fontSize: theme.typography.caption },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: designTokens.spacing.xl }
  });
}
