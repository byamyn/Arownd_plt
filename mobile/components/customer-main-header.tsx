import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import Logo from "@/components/logo";
import { Icon, IconButton } from "@/components/ui";
import { countUnreadNotifications, fetchMyNotifications } from "@/lib/notifications";
import { getSupabaseClient } from "@/lib/supabase";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

type CustomerMainHeaderProps = {
  variant?: "cart" | "settings";
};

export function CustomerMainHeader({ variant = "cart" }: CustomerMainHeaderProps) {
  const theme = useAppTheme();
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
    enabled: auth.isSuccess && Boolean(auth.data),
    staleTime: 30_000
  });
  const unreadCount = notifications.data ? countUnreadNotifications(notifications.data) : 0;

  return (
    <View style={styles.header}>
      <Logo color={theme.colors.foreground} width={148} />
      <View style={styles.actions}>
        <IconButton
          accessibilityLabel={translate("notificationsTitle") + (unreadCount > 0 ? `, ${unreadCount}` : "")}
          onPress={() => router.push("/notifications")}
          icon={(
            <View>
              <Icon name="bell" size={21} color={theme.colors.foreground} accessibilityHidden />
              {unreadCount > 0 ? <View style={[styles.unreadDot, { backgroundColor: theme.colors.accent, borderColor: theme.colors.background }]} /> : null}
            </View>
          )}
          style={[styles.iconButton, { backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border }]}
        />
        {variant === "cart" ? (
          <IconButton
            accessibilityLabel={translate("navExplore")}
            onPress={() => router.push("/explore")}
            icon={<Icon name="search" size={21} color={theme.colors.foreground} accessibilityHidden />}
            style={[styles.iconButton, { backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border }]}
          />
        ) : (
          <IconButton
            accessibilityLabel={translate("profileSettings")}
            onPress={() => router.push("/settings")}
            icon={<Icon name="settings" size={21} color={theme.colors.foreground} accessibilityHidden />}
            style={[styles.iconButton, { backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border }]}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: designTokens.dimensions.controlHeight.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.sm
  },
  iconButton: {
    width: designTokens.dimensions.controlHeight.md,
    height: designTokens.dimensions.controlHeight.md,
    borderRadius: designTokens.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  unreadDot: {
    position: "absolute",
    top: -1,
    end: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5
  }
});
