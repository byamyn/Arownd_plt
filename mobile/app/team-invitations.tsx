import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Alert,
  AppHeader,
  Button,
  Card,
  RefreshableScrollView,
  Spinner,
  StatusBadge,
  Text as UiText
} from "@/components/ui";
import {
  acceptStoreTeamInvitation,
  fetchMyPendingStoreTeamInvitations
} from "@/lib/merchant-team";
import { setActiveMerchantStoreId } from "@/lib/merchant";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

export default function TeamInvitationsScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();

  const invitations = useQuery({
    queryKey: ["my-pending-team-invitations"],
    queryFn: ({ signal }) => fetchMyPendingStoreTeamInvitations(signal),
    retry: false
  });

  const accept = useMutation({
    mutationFn: acceptStoreTeamInvitation,
    onSuccess: async (storeId) => {
      if (storeId) await setActiveMerchantStoreId(storeId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merchant-access"] }),
        queryClient.invalidateQueries({ queryKey: ["my-pending-team-invitations"] })
      ]);
      if (storeId) router.replace("/merchant/orders");
    }
  });

  const formatDate = (value: string) => new Date(value).toLocaleDateString(language === "ar" ? "ar-DZ" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={invitations.isFetching} onRefresh={() => { void invitations.refetch(); }}>
        <AppHeader title={translate("merchantTeamInvitationsTitle")} />
        {invitations.isPending ? (
          <View style={styles.center}><Spinner size="large" /></View>
        ) : invitations.isError ? (
          <Alert
            description={translate("merchantTeamAcceptError")}
            tone="warning"
          />
        ) : invitations.data.length === 0 ? (
          <Card><UiText style={styles.secondaryText}>{translate("merchantTeamNoInvitations")}</UiText></Card>
        ) : (
          invitations.data.map((invitation) => (
            <Card key={invitation.invitation_id} contentStyle={styles.invitationCard}>
              <View style={styles.invitationHeader}>
                <View style={styles.storeDetails}>
                  <UiText weight="700">{invitation.store_name}</UiText>
                  <UiText style={styles.secondaryText}>{invitation.invited_email}</UiText>
                </View>
                <StatusBadge
                  label={invitation.role === "admin" ? translate("merchantTeamRoleAdmin") : translate("merchantTeamRoleStaff")}
                  tone="neutral"
                />
              </View>
              <UiText style={styles.secondaryText}>{translate("merchantTeamExpires")} {formatDate(invitation.expires_at)}</UiText>
              <Button
                label={translate("merchantTeamAccept")}
                onPress={() => accept.mutate(invitation.invitation_id)}
                loading={accept.isPending && accept.variables === invitation.invitation_id}
                disabled={accept.isPending}
                fullWidth
              />
            </Card>
          ))
        )}
        {accept.isError ? <Alert description={translate("merchantTeamAcceptError")} tone="danger" /> : null}
        {accept.isSuccess && accept.data === null ? <Alert description={translate("merchantTeamInvitationExpired")} tone="warning" /> : null}
      </RefreshableScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.xl, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.lg },
    center: { minHeight: 160, alignItems: "center", justifyContent: "center" },
    invitationCard: { gap: designTokens.spacing.md },
    invitationHeader: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
    storeDetails: { flex: 1, minWidth: 0, gap: 3 },
    secondaryText: { color: theme.colors.muted, fontSize: theme.typography.caption, lineHeight: 19 }
  });
}
