import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Image as NativeImage, Modal, StyleSheet, View } from "react-native";

import { designTokens, useAppTheme } from "@/lib/theme";
import { CustomerScreen, ErrorState, LoadingState } from "@/components/customer-ui";
import {
  AppHeader,
  BottomSheet,
  Button,
  Caption,
  Card,
  Text as UiText,
  Icon,
  IconButton,
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
import { fetchMyReviews } from "@/lib/reviews";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchStoreVerificationReviewerAccess } from "@/lib/store-verification";

export default function ProfileScreen() {
  useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [avatarPickerError, setAvatarPickerError] = useState(false);
  const [avatarActionsOpen, setAvatarActionsOpen] = useState(false);
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
    queryFn: fetchMyDeliveryProfile,
    enabled: Boolean(user.data)
  });
  const verificationReviewer = useQuery({
    queryKey: ["store-verification-reviewer"],
    queryFn: fetchStoreVerificationReviewerAccess,
    enabled: Boolean(user.data),
    retry: false
  });
  const orders = useQuery({
    queryKey: ["my-orders"],
    queryFn: fetchMyOrders,
    enabled: Boolean(user.data)
  });
  const favorites = useQuery({
    queryKey: ["local-favorites"],
    queryFn: getFavorites,
    enabled: Boolean(user.data)
  });
  const reviews = useQuery({
    queryKey: ["my-reviews"],
    queryFn: fetchMyReviews,
    enabled: Boolean(user.data),
    retry: false
  });

  if (user.isPending) {
    return <CustomerScreen><AppHeader title={translate("profileTitle")} /><LoadingState label={translate("stateLoading")} /></CustomerScreen>;
  }
  if (user.isError) {
    return (
      <CustomerScreen refreshing={user.isFetching} onRefresh={() => { void user.refetch(); }}>
        <AppHeader title={translate("profileTitle")} />
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
        <AppHeader title={translate("profileTitle")} />
        <Caption>{translate("profileSubtitle")}</Caption>
        <Caption>{translate("profileLoginHint")}</Caption>
        <Button label={translate("profileLogin")} onPress={() => router.push("/login")} fullWidth />
      </CustomerScreen>
    );
  }
  if (profile.isError) {
    return (
      <CustomerScreen refreshing={profile.isFetching} onRefresh={() => { void profile.refetch(); }}>
        <AppHeader title={translate("profileTitle")} />
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
      <AppHeader
        title={translate("profileTitle")}
        leading={
          <View style={styles.headerActions}>
            <IconButton
              icon={<Icon name="settings" size={20} />}
              accessibilityLabel={translate("profileSettings")}
              onPress={() => router.push("/settings")}
            />
          </View>
        }
      />
      <Caption>{translate("profileSubtitle")}</Caption>

      {profile.isPending ? (
        <LoadingState label={translate("stateLoading")} />
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

          <Card contentStyle={styles.accountLinksCard}>
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileEditDetails")} onPress={() => router.push("/delivery-profile")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="user" size={20} color={theme.colors.accent} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileEditDetails")}</UiText>
                <Caption>{translate("profileEditDetailsHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
            <View style={[styles.accountLinkDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileAddresses")} onPress={() => router.push("/addresses")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="map-pin" size={20} color={theme.colors.accent} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileAddresses")}</UiText>
                <Caption>{translate("profileAddressesHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
            <View style={[styles.accountLinkDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface accessibilityRole="button" accessibilityLabel={translate("profileInvite")} onPress={() => router.push("/invite")} style={styles.accountLinkRow}>
              <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="gift" size={20} color={theme.colors.accent} /></View>
              <View style={styles.accountLinkText}>
                <UiText weight="700">{translate("profileInvite")}</UiText>
                <Caption>{translate("profileInviteHint")}</Caption>
              </View>
              <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
            </PressableSurface>
            {verificationReviewer.data === true ? (
              <>
                <View style={[styles.accountLinkDivider, { backgroundColor: theme.colors.border }]} />
                <PressableSurface accessibilityRole="button" accessibilityLabel={translate("verificationModerationTitle")} onPress={() => router.push("/moderation/store-verifications")} style={styles.accountLinkRow}>
                  <View style={[styles.accountLinkIcon, { backgroundColor: theme.colors.surfaceSecondary }]}><Icon name="circle-check" size={20} color={theme.colors.accent} /></View>
                  <View style={styles.accountLinkText}>
                    <UiText weight="700">{translate("verificationModerationTitle")}</UiText>
                    <Caption>{translate("verificationModerationSubtitle")}</Caption>
                  </View>
                  <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
                </PressableSurface>
              </>
            ) : null}
          </Card>

          <Card contentStyle={styles.statsCard}>
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={translate("profileOrders")}
              onPress={() => router.push("/orders")}
              style={styles.statCardOuter}
            >
              <View style={styles.statHeader}>
                <View style={[styles.statIcon, { backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }]}>
                  <Icon name="package" size={designTokens.dimensions.iconSize.sm} />
                </View>
                <StatCard
                  label={translate("profileOrders")}
                  value={orders.isPending ? "…" : orders.isError ? "—" : String(orders.data?.length ?? 0)}
                  style={styles.stat}
                />
              </View>
            </PressableSurface>
            <View style={[styles.statsDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={translate("profileFavorites")}
              onPress={() => router.push("/favorites")}
              style={styles.statCardOuter}
            >
              <View style={styles.statHeader}>
                <View style={[styles.statIcon, { backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }]}>
                  <Icon name="heart" size={designTokens.dimensions.iconSize.sm} />
                </View>
                <StatCard
                  label={translate("profileFavorites")}
                  value={favorites.isPending ? "…" : favorites.isError ? "—" : String(favoriteCount)}
                  style={styles.stat}
                />
              </View>
            </PressableSurface>
            <View style={[styles.statsDivider, { backgroundColor: theme.colors.border }]} />
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={translate("myReviewsTitle")}
              onPress={() => router.push("/my-reviews")}
              style={styles.statCardOuter}
            >
              <View style={styles.statHeader}>
                <View style={[styles.statIcon, { backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }]}>
                  <Icon name="star" size={designTokens.dimensions.iconSize.sm} />
                </View>
                <StatCard
                  label={translate("myReviewsTitle")}
                  value={reviews.isPending ? "…" : reviews.isError ? "—" : String(reviews.data?.length ?? 0)}
                  style={styles.stat}
                />
              </View>
            </PressableSurface>
          </Card>

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
        visible={avatarActionsOpen}
        onRequestClose={() => setAvatarActionsOpen(false)}
      >
        <UiText weight="700">{translate("profileAvatarOptionsTitle")}</UiText>
        <PressableSurface
          onPress={() => { void chooseAvatar(); }}
          disabled={uploadAvatar.isPending || removeAvatar.isPending}
          style={[styles.avatarOption, { backgroundColor: theme.colors.surfaceSecondary }]}
        >
          <Icon name="image" size={21} color={theme.colors.accent} />
          <UiText weight="600">{translate("profileAvatarChooseFromGallery")}</UiText>
        </PressableSurface>
        <PressableSurface
          onPress={() => { void captureAvatar(); }}
          disabled={uploadAvatar.isPending || removeAvatar.isPending}
          style={[styles.avatarOption, { backgroundColor: theme.colors.surfaceSecondary }]}
        >
          <Icon name="camera" size={21} color={theme.colors.accent} />
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
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
  accountLinkRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm },
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
  statsCard: { flexDirection: "row", alignItems: "stretch", paddingVertical: designTokens.spacing.md, paddingHorizontal: designTokens.spacing.xs },
  statCardOuter: { flex: 1, minWidth: 0, justifyContent: "center", paddingHorizontal: designTokens.spacing.xs },
  statsDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch" },
  statHeader: { flexDirection: "column", alignItems: "center", gap: designTokens.spacing.xs },
  statIcon: { width: 32, height: 32, borderRadius: designTokens.radius.md, alignItems: "center", justifyContent: "center" },
  stat: { width: "100%", minWidth: 0, padding: 0, backgroundColor: "transparent" },
});
