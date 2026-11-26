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
  ListItem,
  TextField,
} from "@/components/ui";
import { fetchMyDeliveryProfile } from "@/lib/delivery-profile";
import { fetchCheckoutRegions } from "@/lib/checkout";
import { getRegionDisplayName } from "@/lib/country-regions";
import { removeMyProfileAvatar, uploadMyProfileAvatar } from "@/lib/profile-avatar";
import { getFavorites } from "@/lib/favorites";
import { translate, useLanguage } from "@/lib/i18n";
import { fetchMyOrders } from "@/lib/orders";
import { getProfileDisplayName } from "@/lib/profile-state";
import { fetchMerchantAccess } from "@/lib/merchant";
import { fetchMyPendingStoreTeamInvitations } from "@/lib/merchant-team";
import { fetchMyReviews } from "@/lib/reviews";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchStoreVerificationReviewerAccess } from "@/lib/store-verification";
import { ProfileAccountSheet, type ProfileAccountSection } from "@/components/profile-account-sheet";
import { ProfileActivitySheet, type ProfileActivitySection } from "@/components/profile-activity-sheet";
import { claimMyUsername } from "@/lib/username";

export default function ProfileScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [avatarPickerError, setAvatarPickerError] = useState(false);
  const [avatarActionsOpen, setAvatarActionsOpen] = useState(false);
  const [accountSheet, setAccountSheet] = useState<ProfileAccountSection | null>(null);
  const [activitySheet, setActivitySheet] = useState<ProfileActivitySection | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const uploadAvatar = useMutation({
    mutationFn: uploadMyProfileAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-delivery-profile"] })
  });
  const removeAvatar = useMutation({
    mutationFn: removeMyProfileAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-delivery-profile"] })
  });
  const claimUsername = useMutation({
    mutationFn: claimMyUsername,
    onSuccess: async () => {
      setUsernameDraft("");
      await queryClient.invalidateQueries({ queryKey: ["my-delivery-profile"] });
    }
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
  const profileRegions = useQuery({ queryKey: ["checkout-regions"], queryFn: ({ signal }) => fetchCheckoutRegions(undefined, signal), enabled: Boolean(user.data), staleTime: Infinity });
  const profileSecondaryRegion = useQuery({ queryKey: ["checkout-regions", profile.data?.region_id], queryFn: ({ signal }) => fetchCheckoutRegions(profile.data?.region_id, signal), enabled: Boolean(user.data && profile.data?.region_id), staleTime: Infinity });
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
  const teamInvitations = useQuery({
    queryKey: ["my-pending-team-invitations"],
    queryFn: ({ signal }) => fetchMyPendingStoreTeamInvitations(signal),
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
  const profileArea = [
    profileRegions.data?.regions.find((item) => item.id === profile.data?.region_id)
      ? getRegionDisplayName(profileRegions.data.regions.find((item) => item.id === profile.data?.region_id)!, language)
      : null,
    profileSecondaryRegion.data?.regions.find((item) => item.id === profile.data?.secondary_region_id)
      ? getRegionDisplayName(profileSecondaryRegion.data.regions.find((item) => item.id === profile.data?.secondary_region_id)!, language)
      : null,
    profile.data?.commune || null
  ].filter((value): value is string => Boolean(value)).join("، ");

  return (
    <CustomerScreen
      refreshing={user.isFetching || (Boolean(user.data) && (profile.isFetching || orders.isFetching || favorites.isFetching || reviews.isFetching || teamInvitations.isFetching))}
      onRefresh={() => {
        void user.refetch().then((result) => {
          if (result.isSuccess && result.data) void Promise.all([profile.refetch(), orders.refetch(), favorites.refetch(), reviews.refetch(), teamInvitations.refetch()]);
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
            <View style={styles.identityHeader}>
              <IdentityRow
                name={displayName}
                {...(user.data.email ? { subtitle: user.data.email } : {})}
                {...(profile.data?.avatar_url ? { imageUri: profile.data.avatar_url } : {})}
                avatarSize={64}
                style={styles.identityRow}
              />
            </View>
            {avatarPickerError || uploadAvatar.isError || removeAvatar.isError ? (
              <Caption>{translate("profileAvatarError")}</Caption>
            ) : null}
            {profile.data?.phone || profileArea ? (
              <View style={[styles.phoneRow, { borderTopColor: theme.colors.divider, flexWrap: "wrap", rowGap: designTokens.spacing.xs }]}>
                {profile.data?.phone ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs }}>
                    <Icon name="phone" size={16} />
                    <Caption>{profile.data.phone}</Caption>
                  </View>
                ) : null}
                {profileArea ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs, flexShrink: 1 }}>
                    <Icon name="map-pin" size={16} color={theme.colors.accent} />
                    <Caption>{profileArea}</Caption>
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>

          {!profile.data?.username ? (
            <View style={styles.usernameSection}>
              <UiText weight="700">{translate("usernameClaimTitle")}</UiText>
              <Caption>{translate("usernameClaimHint")}</Caption>
              <TextField value={usernameDraft} onChangeText={(value) => setUsernameDraft(value.toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={30} placeholder={translate("usernamePlaceholder")} label={translate("username")} error={claimUsername.isError ? translate(claimUsername.error instanceof Error && claimUsername.error.message === "USERNAME_TAKEN" ? "usernameTaken" : claimUsername.error instanceof Error && claimUsername.error.message === "USERNAME_INVALID" ? "usernameInvalid" : claimUsername.error.message === "USERNAME_RESERVED" ? "usernameReserved" : "usernameClaimError") : undefined} />
              <Button label={claimUsername.isPending ? translate("usernameClaimBusy") : translate("usernameClaimAction")} onPress={() => claimUsername.mutate(usernameDraft)} disabled={claimUsername.isPending || usernameDraft.length < 3} fullWidth />
            </View>
          ) : null}

          <View style={styles.activityList}>
            <ListItem
              leading={<Icon name="package" size={20} color={theme.colors.muted} />}
              trailing={<View style={styles.listTrailing}><UiText weight="700">{orders.isPending ? "…" : orders.isError ? "—" : String(orders.data?.length ?? 0)}</UiText><Icon name="chevron-left" size={18} color={theme.colors.subtle} /></View>}
              onPress={() => setActivitySheet("orders")}
              accessibilityLabel={translate("profileOrders")}
            >
              <UiText weight="600">{translate("profileOrders")}</UiText>
            </ListItem>
            <ListItem
              leading={<Icon name="heart" size={20} color={theme.colors.muted} />}
              trailing={<View style={styles.listTrailing}><UiText weight="700">{favorites.isPending ? "…" : favorites.isError ? "—" : String(favoriteCount)}</UiText><Icon name="chevron-left" size={18} color={theme.colors.subtle} /></View>}
              onPress={() => setActivitySheet("favorites")}
              accessibilityLabel={translate("profileFavorites")}
            >
              <UiText weight="600">{translate("profileFavorites")}</UiText>
            </ListItem>
            <ListItem
              leading={<Icon name="star" size={20} color={theme.colors.muted} />}
              trailing={<View style={styles.listTrailing}><UiText weight="700">{reviews.isPending ? "…" : reviews.isError ? "—" : String(reviews.data?.length ?? 0)}</UiText><Icon name="chevron-left" size={18} color={theme.colors.subtle} /></View>}
              onPress={() => setActivitySheet("reviews")}
              accessibilityLabel={translate("myReviewsTitle")}
              showDivider={false}
            >
              <UiText weight="600">{translate("myReviewsTitle")}</UiText>
            </ListItem>
          </View>

          {merchantAccess.data?.status === "merchant_ready" && merchantAccess.data.store?.id ? (
            <ListItem
              leading={<Icon name="store" size={20} color={theme.colors.accent} />}
              trailing={<Icon name="chevron-left" size={18} color={theme.colors.subtle} />}
              onPress={() => router.push("/merchant")}
              accessibilityLabel={translate("profileSwitchToStore")}
              showDivider={false}
            >
              <View style={styles.accountLinkText}>
                <UiText weight="600">{translate("merchantMyStore")}</UiText>
                <Caption>{translate("profileSwitchToStoreHint")}</Caption>
              </View>
            </ListItem>
          ) : null}

          {teamInvitations.data && teamInvitations.data.length > 0 ? (
            <ListItem
              leading={<Icon name="users" size={20} color={theme.colors.muted} />}
              trailing={<Icon name="chevron-left" size={18} color={theme.colors.subtle} />}
              onPress={() => router.push("/team-invitations")}
              accessibilityLabel={translate("profileTeamInvitations")}
            >
              <View style={styles.accountLinkText}>
                <UiText weight="600">{translate("profileTeamInvitations")}</UiText>
                <Caption>{translate("profileTeamInvitationsHint")}</Caption>
              </View>
            </ListItem>
          ) : null}



          {verificationReviewer.data === true ? (
            <ListItem
              leading={<Icon name="circle-check" size={20} color={theme.colors.muted} />}
              trailing={<Icon name="chevron-left" size={18} color={theme.colors.subtle} />}
              onPress={() => router.push("/moderation/store-verifications")}
              accessibilityLabel={translate("verificationModerationTitle")}
              showDivider={false}
            >
              <View style={styles.accountLinkText}>
                <UiText weight="600">{translate("verificationModerationTitle")}</UiText>
                <Caption>{translate("verificationModerationSubtitle")}</Caption>
              </View>
            </ListItem>
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
        title={accountSheet === "delivery" ? translate("profileEditAction") : accountSheet === "addresses" ? translate("addressesTitle") : translate("inviteTitle")}
        maxHeight="94%"
      >
        {accountSheet ? <ProfileAccountSheet section={accountSheet} onManageAvatar={() => { setAccountSheet(null); setAvatarActionsOpen(true); }} /> : null}
      </BottomSheet>
      <BottomSheet
        visible={activitySheet !== null}
        onRequestClose={() => setActivitySheet(null)}
        title={activitySheet === "orders" ? translate("profileOrders") : activitySheet === "favorites" ? translate("profileFavorites") : translate("myReviewsTitle")}
        maxHeight="94%"
      >
        {activitySheet ? <ProfileActivitySheet section={activitySheet} onNavigate={() => setActivitySheet(null)} /> : null}
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
  identityHeader: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  identityEditLink: { minHeight: 40, justifyContent: "center", paddingHorizontal: designTokens.spacing.sm },
  avatarOption: { minHeight: 52, borderRadius: designTokens.radius.md, paddingHorizontal: designTokens.spacing.md, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
  avatarModalOverlay: { flex: 1, justifyContent: "center", padding: designTokens.spacing.lg },
  avatarPreviewCard: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md, alignItems: "center" },
  avatarPreviewImage: { width: 220, height: 220, borderRadius: 110, backgroundColor: "transparent" },
  identityRow: { flex: 1, minWidth: 0, flexDirection: "row" },
  usernameSection: { gap: designTokens.spacing.sm },
  activityList: { gap: 0 },
  listTrailing: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
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
  statValue: { fontSize: designTokens.typography.title, textAlign: "center" },
  merchantCard: { minHeight: 112, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.lg, borderRadius: designTokens.radius.xl, borderWidth: 1.5 },
  merchantIcon: { width: 52, height: 52, borderRadius: designTokens.radius.lg, alignItems: "center", justifyContent: "center" },
  merchantText: { flex: 1, minWidth: 0, gap: designTokens.spacing.xs },
});
