import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { PageSkeleton, CustomerScreen, EmptyState, ErrorState } from "@/components/customer-ui";
import {
  Alert,
  AppHeader,
  Button,
  Caption,
  Icon,
  Text as UiText
} from "@/components/ui";
import { countUnreadNotifications, fetchMyNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from "@/lib/notifications";
import { getNotificationDestination } from "@/lib/notifications-state";
import { formatOrderCode } from "@/lib/orders-state";
import { getSupabaseClient } from "@/lib/supabase";
import { translate, type Language, type TranslationKey, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

function typeLabel(type: AppNotification["type"]): string {
  const labels: Record<AppNotification["type"], string> = {
    order: translate("notificationsOrder"),
    offer: translate("notificationsOffer"),
    reservation: translate("notificationsReservation"),
    system: translate("notificationsSystem"),
    info: translate("notificationsInfo")
  };
  return labels[type];
}

function localizedNotificationCopy(item: AppNotification): { title: string; body: string | null } {
  if (item.type === "system" && item.data.kind === "support_reply") {
    return { title: translate("supportNotificationTitle"), body: item.body };
  }
  if (item.type !== "order") return { title: item.title, body: item.body };

  const status = typeof item.data.status === "string" ? item.data.status : null;
  const notificationUrl = typeof item.data.url === "string" ? item.data.url : "";
  const isMerchantNewOrder = (item.data.recipient_role === "merchant" && status === "pending")
    || notificationUrl.startsWith("/studio/orders/");
  if (isMerchantNewOrder) {
    return {
      title: translate("notificationsMerchantNewOrderTitle"),
      body: translate("notificationsMerchantNewOrderBody")
    };
  }

  const statusKeys: Partial<Record<string, TranslationKey>> = {
    pending: "notificationsOrderPending",
    quoted: "notificationsOrderQuoted",
    confirmed: "notificationsOrderConfirmed",
    shipped: "notificationsOrderShipped",
    delivered: "notificationsOrderDelivered",
    cancelled: "notificationsOrderCancelled",
    accepted: "notificationsShipmentAccepted",
    picked_up: "notificationsShipmentPickedUp",
    in_transit: "notificationsShipmentInTransit",
    failed: "notificationsShipmentFailed",
    returned: "notificationsShipmentReturned",
    rejected: "notificationsShipmentRejected"
  };
  const bodyKey = status ? statusKeys[status] : undefined;
  if (!bodyKey) return { title: item.title, body: item.body };

  return {
    title: translate("notificationsOrderUpdateTitle"),
    body: translate(bodyKey)
  };
}

function dateLabel(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : "en-DZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function NotificationsScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const auth = useQuery({
    queryKey: ["notifications-auth"],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().auth.getUser();
      if (error) throw error;
      return data.user;
    },
    retry: false
  });
  const notifications = useQuery({
    queryKey: ["my-notifications", auth.data?.id],
    queryFn: ({ signal }) => fetchMyNotifications(signal),
    enabled: auth.isSuccess && Boolean(auth.data)
  });

  useEffect(() => {
    const userId = auth.data?.id;
    if (!userId) return;
    const client = getSupabaseClient();
    const channel = client.channel("native-notifications-" + userId).on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "notifications",
      filter: "user_id=eq." + userId
    }, () => {
      void queryClient.invalidateQueries({ queryKey: ["my-notifications", userId] });
    }).subscribe();

    return () => { void client.removeChannel(channel); };
  }, [auth.data?.id, queryClient]);

  const markOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      setActionError(false);
      return queryClient.invalidateQueries({ queryKey: ["my-notifications", auth.data?.id] });
    },
    onError: () => setActionError(true)
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      setActionError(false);
      return queryClient.invalidateQueries({ queryKey: ["my-notifications", auth.data?.id] });
    },
    onError: () => setActionError(true)
  });

  if (auth.isPending || (auth.data && notifications.isPending)) {
    return <CustomerScreen><AppHeader title={translate("notificationsTitle")} /><PageSkeleton variant="list" rows={4} /></CustomerScreen>;
  }
  if (auth.isError || notifications.isError) {
    return (
      <CustomerScreen refreshing={auth.isFetching || (Boolean(auth.data) && notifications.isFetching)} onRefresh={() => { void auth.refetch().then((result) => { if (result.isSuccess && result.data) void notifications.refetch(); }); }}>
        <AppHeader title={translate("notificationsTitle")} />
        <ErrorState
          title={translate("notificationsLoadError")}
          retryLabel={translate("retry")}
          busy={auth.isFetching || notifications.isFetching}
          onRetry={() => { void auth.refetch(); void notifications.refetch(); }}
        />
      </CustomerScreen>
    );
  }
  if (!auth.data) {
    return (
      <CustomerScreen>
        <AppHeader title={translate("notificationsTitle")} trailing={<Caption>{translate("profileLoginHint")}</Caption>} />
        <Button label={translate("login")} onPress={() => router.push("/login")} fullWidth />
      </CustomerScreen>
    );
  }

  const rows = notifications.data ?? [];
  const unreadCount = countUnreadNotifications(rows);
  const visibleRows = filter === "unread" ? rows.filter((item) => !item.read) : rows;
  const iconByType: Record<AppNotification["type"], "package" | "percent" | "calendar" | "lock" | "bell"> = {
    order: "package",
    offer: "percent",
    reservation: "calendar",
    system: "lock",
    info: "bell"
  };

  return (
    <CustomerScreen
      refreshing={auth.isFetching || (Boolean(auth.data) && notifications.isFetching)}
      onRefresh={() => { void auth.refetch().then((result) => { if (result.isSuccess && result.data) void notifications.refetch(); }); }}
    >
      <AppHeader title={translate("notificationsTitle")} />
      {actionError ? <Alert tone="danger" description={translate("notificationsMarkError")} /> : null}
      <View style={styles.toolbar}>
        <View style={styles.filters}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: filter === "all" }}
            onPress={() => setFilter("all")}
            style={[styles.filterButton, filter === "all" && { backgroundColor: theme.colors.accent }]}
          >
            <UiText weight="700" style={{ color: filter === "all" ? theme.colors.accentForeground : theme.colors.muted }}>
              {translate("ordersTabAll")}
            </UiText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: filter === "unread" }}
            onPress={() => setFilter("unread")}
            style={[styles.filterButton, filter === "unread" && { backgroundColor: theme.colors.accent }]}
          >
            <UiText weight="700" style={{ color: filter === "unread" ? theme.colors.accentForeground : theme.colors.muted }}>
              {language === "ar" ? "غير المقروءة" : "Unread"}{unreadCount > 0 ? ` · ${unreadCount}` : ""}
            </UiText>
          </Pressable>
        </View>
        {unreadCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={markAll.isPending}
            onPress={() => markAll.mutate()}
            style={styles.markAllButton}
          >
            <UiText weight="700" tone="accentMuted">{translate("notificationsMarkAll")}</UiText>
          </Pressable>
        ) : null}
      </View>
      {rows.length === 0 ? (
        <EmptyState icon="bell" title={translate("notificationsEmpty")} hint={translate("notificationsEmptyHint")} />
      ) : visibleRows.length === 0 ? (
        <EmptyState icon="bell" title={language === "ar" ? "لا توجد إشعارات غير مقروءة" : "No unread notifications"} />
      ) : (
        <View style={styles.list}>
          {visibleRows.map((item) => {
            const destination = getNotificationDestination(item);
            const orderId = typeof item.data.order_id === "string" ? item.data.order_id : null;
            const orderCode = item.type === "order" && orderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)
              ? formatOrderCode(orderId)
              : null;
            const copy = localizedNotificationCopy(item);
            const body = orderCode && copy.body && orderId
              ? copy.body.replace(new RegExp(orderId.slice(0, 8), "i"), orderCode)
              : copy.body;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={copy.title}
                onPress={() => {
                  if (!item.read) markOne.mutate(item.id);
                  if (destination) router.push(destination as never);
                }}
                style={({ pressed }) => [styles.notificationRow, pressed && styles.notificationPressed]}
              >
                <View style={[styles.iconWrap, { backgroundColor: theme.colors.surfaceSecondary }]}>
                  <Icon name={iconByType[item.type]} size={theme.dimensions.iconSize.md} color={theme.colors.foreground} />
                </View>
                <View style={styles.notificationCopy}>
                  <UiText weight="700" numberOfLines={1}>{copy.title}</UiText>
                  <Caption numberOfLines={1}>{orderCode ? `${translate("ordersCode")}: ${orderCode}` : body || typeLabel(item.type)}</Caption>
                </View>
                <View style={styles.notificationMeta}>
                  <Caption>{dateLabel(item.created_at, language)}</Caption>
                  {!item.read ? <View style={[styles.unreadDot, { backgroundColor: theme.colors.accent }]} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </CustomerScreen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: designTokens.spacing.sm
  },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.xs
  },
  filterButton: {
    minHeight: 34,
    paddingHorizontal: designTokens.spacing.md,
    borderRadius: designTokens.radius.pill,
    alignItems: "center",
    justifyContent: "center"
  },
  markAllButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: designTokens.spacing.xs
  },
  list: {
    gap: 0
  },
  notificationRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md,
    paddingVertical: designTokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(127,127,127,0.24)"
  },
  notificationPressed: {
    opacity: 0.72
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: designTokens.radius.lg,
    alignItems: "center",
    justifyContent: "center"
  },
  notificationCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0
  },
  notificationMeta: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: designTokens.spacing.sm
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: designTokens.radius.pill
  }
});
