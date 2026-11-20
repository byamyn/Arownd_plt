import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Image as NativeImage, Modal, StyleSheet, View } from "react-native";

import { designTokens, useAppTheme } from "@/lib/theme";
import { CustomerMainHeader } from "@/components/customer-main-header";
import { PageSkeleton, CustomerScreen, ErrorState } from "@/components/customer-ui";
import {
  BottomSheet,
  Button,
  Caption,
  Card,
  Text as UiText,
  Icon,
  IdentityRow,
  PressableSurface,
  StatCard
} from "@/components/ui";
import { fetchMyDeliveryProfile } from "@/lib/delivery-profile";
import { removeMyProfileAvatar, uploadMyProfileAvatar } from "@/lib/profile-avatar";
import { getFavorites } from "@/lib/favorites";
import { translate, useLanguage } from "@/lib/i18n";
import { fetchMyOrders } from "@/lib/orders";
import { getProfileDisplayName } from "@/lib/profile-state";
import { fetchMerchantAccess } from "@/lib/merchant";
import { fetchMyReviews } from "@/lib/reviews";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchStoreVerificationReviewerAccess } from "@/lib/store-verification";
import { ProfileAccountSheet, type ProfileAccountSection } from "@/components/profile-account-sheet";

export default function ProfileScreen() {
  useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [avatarPickerError, setAvatarPickerError] = useState(false);
  const [avatarActionsOpen, setAvatarActionsOpen] = useState(false);
  const [accountSheet, setAccountSheet] = useState<ProfileAccountSection | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const uploadAvatar = useMutation({
    mutationFn: uploadMyProfileAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-delivery-profile"] })
  });
  const removeAvatar = useMutation({
    mutationFn: removeMyProfileAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-delivery-profile"] })
  });
  const chooseAvatar = async () => {
    setAvatarActionsOpen(false);
    setAvatarPickerError(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAvatarPickerError(true);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85
      });
      if (!result.canceled && result.assets[0]) setSelectedAvatar(result.assets[0]);
    } catch {
      setAvatarPickerError(true);
    }
  };
  const captureAvatar = async () => {
    setAvatarActionsOpen(false);
    setAvatarPickerError(false);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setAvatarPickerError(true);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85
      });
      if (!result.canceled && result.assets[0]) setSelectedAvatar(result.assets[0]);
    } catch {
      setAvatarPickerError(true);
    }
  };
  const user = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().auth.getUser();
      if (error) throw error;
      return data.user;
    },
    retry: false
  });
  const profile = useQuery({
    queryKey: ["my-delivery-profile"],
    queryFn: ({ signal }) => fetchMyDeliveryProfile(signal),
    enabled: Boolean(user.data)
  });
  const verificationReviewer = useQuery({
    queryKey: ["store-verification-reviewer"],
    queryFn: ({ signal }) => fetchStoreVerificationReviewerAccess(signal),
    enabled: Boolean(user.data),
    retry: false
  });
  const merchantAccess = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    enabled: Boolean(user.data),
    retry: false
  });
  const orders = useQuery({
    queryKey: ["my-orders"],
    queryFn: ({ signal }) => fetchMyOrders(signal),
    enabled: Boolean(user.data)
  });
  const favorites = useQuery({
    queryKey: ["local-favorites"],
    queryFn: getFavorites,
    enabled: Boolean(user.data)
  });
  const reviews = useQuery({
    queryKey: ["my-reviews"],
    queryFn: ({ signal }) => fetchMyReviews(signal),
    enabled: Boolean(user.data),
    retry: false
  });

  if (user.isPending) {
    return <CustomerScreen><CustomerMainHeader variant="settings" /><PageSkeleton variant="profile" rows={3} /></CustomerScreen>;
  }
  if (user.isError) {
    return (
      <CustomerScreen refreshing={user.isFetching} onRefresh={() => { void user.refetch(); }}>
        <CustomerMainHeader variant="settings" />
        <ErrorState
          title={translate("profileLoadError")}
          retryLabel={translate("retry")}
          busy={user.isFetching}
          onRetry={() => void user.refetch()}
        />
      </CustomerScreen>
    );
  }
  if (!user.data) {
    return (
      <CustomerScreen>
        <CustomerMainHeader variant="settings" />
        <Caption>{translate("profileSubtitle")}</Caption>
        <Caption>{translate("profileLoginHint")}</Caption>
        <Button label={translate("profileLogin")} onPress={() => router.push("/login")} fullWidth />
      </CustomerScreen>
    );
  }
  if (profile.isError) {
    return (
      <CustomerScreen refreshing={profile.isFetching} onRefresh={() => { void profile.refetch(); }}>
        <CustomerMainHeader variant="settings" />
        <ErrorState
          title={translate("profileLoadError")}
          retryLabel={translate("retry")}
          busy={profile.isFetching}
          onRetry={() => void profile.refetch()}
        />
      </CustomerScreen>
    );
  }

  const displayName = getProfileDisplayName(profile.data?.full_name, user.data.email);
  const favoriteCount = (favorites.data?.products.length ?? 0) + (favorites.data?.stores.length ?? 0);

  return (
    <CustomerScreen
      refreshing={user.isFetching || (Boolean(user.data) && (profile.isFetching || orders.isFetching || favorites.isFetching || reviews.isFetching))}
      onRefresh={() => {
        void user.refetch().then((result) => {
          if (result.isSuccess && result.data) void Promise.all([profile.refetch(), orders.refetch(), favorites.refetch(), reviews.refetch()]);
        });
      }}
    >
      <CustomerMainHeader variant="settings" />
      <Caption>{translate("profileSubtitle")}</Caption>

      {profile.isPending ? (
        <PageSkeleton variant="profile" rows={2} />
      ) : (
        <>
          <Card contentStyle={styles.identityCard}>
            <View style={styles.avatarIdentityWrap}>
              <IdentityRow
                name={displayName}
                {...(user.data.email ? { subtitle: user.data.email } : {})}
                {...(profile.data?.avatar_url ? { imageUri: profile.data.avatar_url } : {})}
                avatarSize={64}
                style={styles.identityRow}
              />
              <PressableSurface
                accessibilityLabel={translate("profileAvatarChange")}
                accessibilityHint={translate("profileAvatarOptionsTitle")}
                onPress={() => setAvatarActionsOpen(true)}
                disabled={uploadAvatar.isPending || removeAvatar.isPending}
                style={styles.avatarActionTrigger}
              >
                <View style={[styles.avatarCameraBadge, { backgroundColor: theme.colors.accent, borderColor: theme.colors.surface }]}>
                  <Icon name="camera" size={13} color={theme.colors.accentForeground} />
                </View>
              </PressableSurface>
            </View>
            {avatarPickerError || uploadAvatar.isError || removeAvatar.isError ? (
              <Caption>{translate("profileAvatarError")}</Caption>
            ) : null}
            {profile.data?.phone ? (
              <View style={[styles.phoneRow, { borderTopColor: theme.colors.border }]}>
                <Caption>{profile.data.phone}</Caption>
                <Icon name="phone" size={16} />
              </View>
            ) : null}
          </Card>

          {merchantAccess.data?.status === "merchant_ready" && merchantAccess.data.store?.id ? (
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={translate("profileSwitchToStore")}
              onPress={() => router.push("/merchant")}
              style={[styles.merchantCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.accent }]}
            >
              <View style={[styles.merchantIcon, { backgroundColor: theme.colors.accent }]}>
                <Icon name="store" size={24} color={theme.colors.accentForeground} />
              </View>
              <View style={styles.merchantText}>
                <UiText weight="700">{translate("merchantMyStore")}</UiText>
                <Caption>{translate("profileSwitchToStoreHint")}</Caption>
                <UiText weight="600" style={{ color: theme.colors.accentOnSurface }}>{translate("profileSwitchToStore")}</UiText>
              </View>
              <Icon name="chevron-left" size={20} color={theme.colors.subtle} />
            </PressableSurface>
          ) : null}

          <Card contentStyle={styles.accountLinksCard}>
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileTeamInvitations")} onPress={() => router.push("/team-invitations")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="users" size={20} color={theme.colors.accentOnSurface} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileTeamInvitations")}</UiText>
                <Caption>{translate("profileTeamInvitationsHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
            <View style={[styles.accountLinkDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileEditDetails")} onPress={() => setAccountSheet("delivery")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="user" size={20} color={theme.colors.accentOnSurface} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileEditDetails")}</UiText>
                <Caption>{translate("profileEditDetailsHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
            <View style={[styles.accountLinkDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileAddresses")} onPress={() => setAccountSheet("addresses")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="map-pin" size={20} color={theme.colors.accentOnSurface} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileAddresses")}</UiText>
                <Caption>{translate("profileAddressesHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
            <View style={[styles.accountLinkDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileInvite")} onPress={() => setAccountSheet("invite")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="gift" size={20} color={theme.colors.accentOnSurface} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileInvite")}</UiText>
                <Caption>{translate("profileInviteHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
          </Card>



          {verificationReviewer.data === true ? (
            <Card contentStyle={styles.accountLinksCard}>
              <PressableSurface accessibilityRole="button" accessibilityLabel={translate("verificationModerationTitle")} onPress={() => router.push("/moderation/store-verifications")} style={styles.accountLinkRow}>
                <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="circle-check" size={20} color={theme.colors.accentOnSurface} /></View>
                <View style={styles.accountLinkText}>
                  <UiText weight="700">{translate("verificationModerationTitle")}</UiText>
                  <Caption>{translate("verificationModerationSubtitle")}</Caption>
                </View>
                <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
              </PressableSurface>
            </Card>
          ) : null}

          {orders.isError || favorites.isError || reviews.isError ? (
            <ErrorState
              title={translate("profileStatsLoadError")}
              retryLabel={translate("retry")}
              busy={orders.isFetching || favorites.isFetching || reviews.isFetching}
              onRetry={() => { void orders.refetch(); void favorites.refetch(); void reviews.refetch(); }}
            />
          ) : null}
        </>
      )}
      <BottomSheet
        visible={accountSheet !== null}
        onRequestClose={() => setAccountSheet(null)}
        title={accountSheet === "delivery" ? translate("deliveryProfileTitle") : accountSheet === "addresses" ? translate("addressesTitle") : translate("inviteTitle")}
        height="68%"
        maxHeight="94%"
      >
        {accountSheet ? <ProfileAccountSheet section={accountSheet} /> : null}
      </BottomSheet>
      <BottomSheet
        visible={avatarActionsOpen}
        onRequestClose={() => setAvatarActionsOpen(false)}
        title={translate("profileAvatarOptionsTitle")}
      >
        <PressableSurface
          onPress={() => { void chooseAvatar(); }}
          disabled={uploadAvatar.isPending || removeAvatar.isPending}
          style={[styles.avatarOption, { backgroundColor: theme.colors.surfaceSecondary }]}
        >
          <Icon name="image" size={21} color={theme.colors.accentOnSurface} />
          <UiText weight="600">{translate("profileAvatarChooseFromGallery")}</UiText>
        </PressableSurface>
        <PressableSurface
          onPress={() => { void captureAvatar(); }}
          disabled={uploadAvatar.isPending || removeAvatar.isPending}
          style={[styles.avatarOption, { backgroundColor: theme.colors.surfaceSecondary }]}
        >
          <Icon name="camera" size={21} color={theme.colors.accentOnSurface} />
          <UiText weight="600">{translate("profileAvatarTakePhoto")}</UiText>
        </PressableSurface>
        {profile.data?.avatar_url ? (
          <PressableSurface
            onPress={() => {
              setAvatarActionsOpen(false);
              removeAvatar.mutate();
            }}
            disabled={uploadAvatar.isPending || removeAvatar.isPending}
            style={[styles.avatarOption, { backgroundColor: theme.colors.dangerSurface }]}
          >
            <Icon name="trash-2" size={21} color={theme.colors.danger} />
            <UiText weight="600" style={{ color: theme.colors.danger }}>{translate("profileAvatarRemove")}</UiText>
          </PressableSurface>
        ) : null}
        <Button
          label={translate("profileAvatarCancel")}
          variant="outline"
          onPress={() => setAvatarActionsOpen(false)}
          fullWidth
        />
      </BottomSheet>
      <Modal
        visible={Boolean(selectedAvatar)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAvatar(null)}
      >
        <View style={[styles.avatarModalOverlay, { backgroundColor: theme.colors.overlay }]}>
          <Card contentStyle={styles.avatarPreviewCard}>
            <UiText weight="700">{translate("profileAvatarPreviewTitle")}</UiText>
            <Caption>{translate("profileAvatarPreviewHint")}</Caption>
            {selectedAvatar ? (
              <NativeImage
                source={{ uri: selectedAvatar.uri }}
                resizeMode="cover"
                style={styles.avatarPreviewImage}
              />
            ) : null}
            {uploadAvatar.isError ? <Caption>{translate("profileAvatarError")}</Caption> : null}
            <Button
              label={translate("profileAvatarConfirm")}
              onPress={() => {
                if (selectedAvatar) {
                  uploadAvatar.mutate(selectedAvatar, {
                    onSuccess: () => setSelectedAvatar(null)
                  });
                }
              }}
              loading={uploadAvatar.isPending}
              disabled={!selectedAvatar || removeAvatar.isPending}
              fullWidth
            />
            <Button
              label={translate("profileAvatarChooseAgain")}
              variant="outline"
              onPress={() => {
                setSelectedAvatar(null);
                void chooseAvatar();
              }}
              disabled={uploadAvatar.isPending}
              fullWidth
            />
            <Button
              label={translate("profileAvatarCancel")}
              variant="outline"
              onPress={() => setSelectedAvatar(null)}
              disabled={uploadAvatar.isPending}
              fullWidth
            />
          </Card>
        </View>
      </Modal>
    </CustomerScreen>
  );
}

const styles = StyleSheet.create({
  identityCard: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md },
  avatarIdentityWrap: { position: "relative" },
  avatarActionTrigger: { position: "absolute", start: 0, top: 0, width: 64, height: 64, alignItems: "flex-end", justifyContent: "flex-end" },
  avatarCameraBadge: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  avatarOption: { minHeight: 52, borderRadius: designTokens.radius.md, paddingHorizontal: designTokens.spacing.md, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
  avatarModalOverlay: { flex: 1, justifyContent: "center", padding: designTokens.spacing.lg },
  avatarPreviewCard: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md, alignItems: "center" },
  avatarPreviewImage: { width: 220, height: 220, borderRadius: 110, backgroundColor: "transparent" },
  identityRow: { flexDirection: "row" },
  accountLinksCard: { padding: 0 },
  accountLinkRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm },
  accountLinkDivider: { height: StyleSheet.hairlineWidth, marginStart: 42 + designTokens.spacing.md, marginEnd: designTokens.spacing.md },
  accountLinkIcon: { width: 38, height: 38, borderRadius: designTokens.radius.md, alignItems: "center", justifyContent: "center" },
  accountLinkText: { flex: 1, minWidth: 0, gap: 2 },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.sm,
    paddingTop: designTokens.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  statsGrid: { flexDirection: "row", alignItems: "stretch", gap: designTokens.spacing.sm },
  statTile: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: designTokens.spacing.sm, paddingHorizontal: designTokens.spacing.xs, paddingVertical: designTokens.spacing.md, borderRadius: designTokens.radius.lg, borderWidth: StyleSheet.hairlineWidth },
  statIcon: { width: 34, height: 34, borderRadius: designTokens.radius.md, alignItems: "center", justifyContent: "center" },
  stat: { width: "100%", minWidth: 0, padding: 0, backgroundColor: "transparent", alignItems: "center" },
  merchantCard: { minHeight: 112, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.lg, borderRadius: designTokens.radius.xl, borderWidth: 1.5 },
  merchantIcon: { width: 52, height: 52, borderRadius: designTokens.radius.lg, alignItems: "center", justifyContent: "center" },
  merchantText: { flex: 1, minWidth: 0, gap: designTokens.spacing.xs },
});
