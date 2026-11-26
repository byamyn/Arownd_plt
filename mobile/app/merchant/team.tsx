import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Alert,
  AppHeader,
  BottomSheet,
  Button,
  Card,
  Icon,
  PressableSurface,
  RefreshableScrollView,
  SegmentedControl,
  Spinner,
  StatusBadge,
  Text as UiText,
  TextField
} from "@/components/ui";
import { Avatar } from "@/components/ui/identity";
import { fetchMerchantAccess } from "@/lib/merchant";
import {
  fetchStoreTeamInvitations,
  fetchStoreTeamMembers,
  inviteStoreTeamMember,
  removeStoreTeamMember,
  revokeStoreTeamInvitation,
  updateStoreTeamMemberRole,
  storeTeamInvitationSchema,
  type StoreTeamInvitationInput,
  type StoreTeamInvitation,
  type StoreTeamMember
} from "@/lib/merchant-team";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

type TeamAction =
  | { type: "remove"; member: StoreTeamMember }
  | { type: "revoke"; invitation: StoreTeamInvitation };

export default function MerchantTeamScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TeamAction | null>(null);
  const { control, handleSubmit, reset, formState: { errors: inviteFormErrors } } = useForm<StoreTeamInvitationInput>({
    resolver: zodResolver(storeTeamInvitationSchema),
    defaultValues: { email: "", role: "staff" }
  });

  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });
  const storeId = access.data?.store?.id ?? null;
  const isOwner = access.data?.teamRole === "owner" && Boolean(storeId);

  const members = useQuery({
    queryKey: ["store-team-members", storeId],
    queryFn: ({ signal }) => fetchStoreTeamMembers(storeId ?? "", signal),
    enabled: isOwner,
    retry: false
  });
  const invitations = useQuery({
    queryKey: ["store-team-invitations", storeId],
    queryFn: ({ signal }) => fetchStoreTeamInvitations(storeId ?? "", signal),
    enabled: isOwner,
    retry: false
  });

  const refreshTeam = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["store-team-members", storeId] }),
      queryClient.invalidateQueries({ queryKey: ["store-team-invitations", storeId] })
    ]);
  };

  const invite = useMutation({
    mutationFn: (values: StoreTeamInvitationInput) => inviteStoreTeamMember({ storeId: storeId ?? "", ...values }),
    onSuccess: async () => {
      setInviteOpen(false);
      reset({ email: "", role: "staff" });
      setInviteError(false);
      setNotice(translate("merchantTeamInviteSuccess"));
      await refreshTeam();
    },
    onError: () => setInviteError(true)
  });

  const submitInvite = handleSubmit((values) => {
    setInviteError(false);
    invite.mutate(values);
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: "admin" | "staff" }) =>
      updateStoreTeamMemberRole({ storeId: storeId ?? "", ...input }),
    onSuccess: async () => {
      setActionError(false);
      setNotice(translate("merchantTeamRoleUpdated"));
      await refreshTeam();
    },
    onError: () => setActionError(true)
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => removeStoreTeamMember({ storeId: storeId ?? "", userId }),
    onSuccess: async () => {
      setPendingAction(null);
      setActionError(false);
      setNotice(translate("merchantTeamMemberRemoved"));
      await refreshTeam();
    },
    onError: () => {
      setPendingAction(null);
      setActionError(true);
    }
  });

  const revokeInvitation = useMutation({
    mutationFn: (invitationId: string) => revokeStoreTeamInvitation(invitationId),
    onSuccess: async () => {
      setPendingAction(null);
      setActionError(false);
      setNotice(translate("merchantTeamInvitationRevoked"));
      await refreshTeam();
    },
    onError: () => {
      setPendingAction(null);
      setActionError(true);
    }
  });

  if (access.isPending) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}><Spinner size="large" /></View>
      </SafeAreaView>
    );
  }
  if (access.isError) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <UiText>{translate("merchantLoadError")}</UiText>
          <Button label={translate("merchantRetry")} onPress={() => void access.refetch()} variant="outline" />
        </View>
      </SafeAreaView>
    );
  }
  if (!access.data) return <Redirect href="/login" />;
  if (!isOwner) return <Redirect href="/merchant/orders" />;

  const roleLabel = (role: StoreTeamMember["role"] | StoreTeamInvitation["role"]) =>
    role === "owner" ? translate("merchantTeamRoleOwner") : role === "admin" ? translate("merchantTeamRoleAdmin") : translate("merchantTeamRoleStaff");
  const formatDate = (value: string) => new Date(value).toLocaleDateString(language === "ar" ? "ar-DZ" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const teamLoadError = members.isError || invitations.isError;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching || members.isFetching || invitations.isFetching} onRefresh={() => { void Promise.all([access.refetch(), members.refetch(), invitations.refetch()]); }}>
        <AppHeader title={translate("merchantTeamTitle")} onBack={() => router.replace("/merchant/account-settings")} />
        <UiText style={styles.subtitle}>{translate("merchantTeamSubtitle")}</UiText>

        {notice ? <Alert description={notice} tone="success" /> : null}
        {actionError || teamLoadError ? (
          <Alert description={teamLoadError ? translate("merchantTeamLoadError") : translate("merchantTeamActionError")} tone="danger" />
        ) : null}

        <View style={styles.sectionHeader}>
          <UiText weight="700">{translate("merchantTeamMembers")}</UiText>
          <StatusBadge label={String(members.data?.length ?? 0)} tone="neutral" />
        </View>

        {members.isPending ? (
          <View style={styles.center}><Spinner /></View>
        ) : members.data?.length ? (
          <View style={styles.listCard}>
            {members.data.map((member, index) => (
              <View key={member.user_id} style={[styles.member, index > 0 && styles.memberDivider]}>
                <View style={styles.memberTop}>
                  <Avatar name={member.full_name || member.email} imageUri={member.avatar_url ?? undefined} size={46} />
                  <View style={styles.memberIdentity}>
                    <UiText weight="700" numberOfLines={1}>{member.full_name || member.email}</UiText>
                    <UiText style={styles.secondaryText} numberOfLines={1}>{member.email}</UiText>
                  </View>
                  <StatusBadge label={roleLabel(member.role)} tone={member.role === "owner" ? "accent" : "neutral"} />
                </View>
                {member.role !== "owner" ? (
                  <View style={styles.memberActions}>
                    <View style={styles.roleControl}>
                      <SegmentedControl
                        options={[
                          { key: "admin", label: translate("merchantTeamRoleAdmin") },
                          { key: "staff", label: translate("merchantTeamRoleStaff") }
                        ]}
                        value={member.role}
                        onChange={(value) => {
                          if (value === "admin" || value === "staff") {
                            setActionError(false);
                            changeRole.mutate({ userId: member.user_id, role: value });
                          }
                        }}
                        accessibilityLabel={translate("merchantTeamChangeRole")}
                      />
                    </View>
                    <PressableSurface
                      accessibilityLabel={translate("merchantTeamRemove")}
                      disabled={removeMember.isPending || changeRole.isPending}
                      onPress={() => setPendingAction({ type: "remove", member })}
                      style={styles.removeButton}
                    >
                      <Icon name="trash-2" size={18} color={theme.colors.dangerText} />
                    </PressableSurface>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <UiText style={styles.secondaryText}>{translate("merchantTeamEmpty")}</UiText>
        )}

        <View style={styles.sectionHeader}>
          <UiText weight="700">{translate("merchantTeamInvitations")}</UiText>
          <StatusBadge label={String(invitations.data?.length ?? 0)} tone="neutral" />
        </View>

        {invitations.isPending ? (
          <View style={styles.center}><Spinner /></View>
        ) : invitations.data?.length ? (
          <View style={styles.listCard}>
            {invitations.data.map((invitation, index) => {
              const expired = new Date(invitation.expires_at).getTime() <= Date.now();
              return (
                <View key={invitation.id} style={[styles.invitation, index > 0 && styles.memberDivider]}>
                  <View style={styles.memberIdentity}>
                    <UiText weight="700">{invitation.invited_email}</UiText>
                    <UiText style={styles.secondaryText}>{roleLabel(invitation.role)} · {translate("merchantTeamExpires")} {formatDate(invitation.expires_at)}</UiText>
                    {expired ? <StatusBadge label={translate("merchantTeamInvitationExpired")} tone="warning" /> : null}
                  </View>
                  <Button
                    label={translate("merchantTeamRevoke")}
                    variant="ghost"
                    size="sm"
                    disabled={revokeInvitation.isPending}
                    onPress={() => setPendingAction({ type: "revoke", invitation })}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <UiText style={styles.secondaryText}>{translate("merchantTeamInvitationsEmpty")}</UiText>
        )}

        <Button
          label={translate("merchantTeamInvite")}
          onPress={() => {
            setInviteError(false);
            setInviteOpen(true);
          }}
          fullWidth
        />
      </RefreshableScrollView>

      <BottomSheet visible={inviteOpen} onRequestClose={() => setInviteOpen(false)} title={translate("merchantTeamInvite")}>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextField
              label={translate("merchantTeamInviteEmail")}
              value={value}
              onChangeText={(nextValue) => {
                onChange(nextValue);
                setInviteError(false);
              }}
              onBlur={onBlur}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!invite.isPending}
              error={inviteFormErrors.email ? translate("invalidEmail") : undefined}
            />
          )}
        />
        <UiText weight="700">{translate("merchantTeamRole")}</UiText>
        <Controller
          control={control}
          name="role"
          render={({ field: { onChange, value } }) => (
            <SegmentedControl
              options={[
                { key: "admin", label: translate("merchantTeamRoleAdmin") },
                { key: "staff", label: translate("merchantTeamRoleStaff") }
              ]}
              value={value}
              onChange={onChange}
              accessibilityLabel={translate("merchantTeamRole")}
            />
          )}
        />
        {inviteError ? <Alert description={translate("merchantTeamInviteError")} tone="danger" /> : null}
        <Alert description={translate("merchantTeamInviteHint")} tone="info" />
        <Button
          label={translate("merchantTeamInviteSend")}
          onPress={() => void submitInvite()}
          loading={invite.isPending}
          fullWidth
        />
      </BottomSheet>

      <BottomSheet
        visible={pendingAction !== null}
        onRequestClose={() => setPendingAction(null)}
        title={pendingAction?.type === "remove" ? translate("merchantTeamRemove") : translate("merchantTeamRevoke")}
      >
        <UiText>
          {pendingAction?.type === "remove"
            ? translate("merchantTeamRemoveConfirm")
            : pendingAction?.type === "revoke"
              ? translate("merchantTeamRevoke")
              : ""}
        </UiText>
        <View style={styles.confirmActions}>
          <Button label={translate("back")} variant="outline" onPress={() => setPendingAction(null)} style={styles.actionButton} />
          <Button
            label={pendingAction?.type === "remove" ? translate("merchantTeamRemove") : translate("merchantTeamRevoke")}
            variant="primary"
            loading={removeMember.isPending || revokeInvitation.isPending}
            onPress={() => {
              if (pendingAction?.type === "remove") removeMember.mutate(pendingAction.member.user_id);
              if (pendingAction?.type === "revoke") revokeInvitation.mutate(pendingAction.invitation.id);
            }}
            style={styles.actionButton}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.xl, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.lg },
    subtitle: { color: theme.colors.muted, fontSize: theme.typography.caption + 1, lineHeight: 20 },
    sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: designTokens.spacing.sm },
    listCard: { gap: 0 },
    member: { padding: designTokens.spacing.md, gap: designTokens.spacing.md },
    memberDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    memberTop: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
    memberIdentity: { flex: 1, minWidth: 0, gap: 3 },
    secondaryText: { color: theme.colors.muted, fontSize: theme.typography.caption, lineHeight: 18 },
    memberActions: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
    roleControl: { flex: 1 },
    removeButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, backgroundColor: theme.colors.dangerSurface },
    invitation: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm, padding: designTokens.spacing.md },
    center: { minHeight: 110, alignItems: "center", justifyContent: "center" },
    confirmActions: { flexDirection: "row", gap: designTokens.spacing.sm },
    actionButton: { flex: 1 }
  });
}
