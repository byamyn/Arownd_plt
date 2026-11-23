import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, StyleSheet, TextInput, Image, View } from "react-native";

import { CustomerScreen, EmptyState, ErrorState, PageSkeleton } from "@/components/customer-ui";
import { Alert, AppHeader, Button, Caption, Icon, IconButton, PressableSurface, Text as UiText, TextArea } from "@/components/ui";
import {
  fetchMerchantOrderDisputeById,
  fetchMerchantOrderDisputeMessages,
  getMerchantOrderDisputeParticipantRole,
  resolveMerchantOrderDispute,
  sendMerchantOrderDisputeMessage
} from "@/lib/merchant-order-disputes";
import { getSupabaseClient } from "@/lib/supabase";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

function dateLabel(value: string, language: "ar" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : "en-DZ", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

export default function MerchantOrderDisputeChatScreen() {
  const { disputeId } = useLocalSearchParams<{ disputeId: string }>();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [attachmentError, setAttachmentError] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");

  const role = useQuery({
    queryKey: ["merchant-order-dispute-role", disputeId],
    queryFn: () => getMerchantOrderDisputeParticipantRole(disputeId),
    enabled: Boolean(disputeId),
    retry: false
  });
  const dispute = useQuery({
    queryKey: ["merchant-order-dispute", disputeId],
    queryFn: ({ signal }) => fetchMerchantOrderDisputeById(disputeId, signal),
    enabled: Boolean(disputeId) && role.isSuccess && Boolean(role.data)
  });
  const messages = useQuery({
    queryKey: ["merchant-order-dispute-messages", disputeId],
    queryFn: ({ signal }) => fetchMerchantOrderDisputeMessages(disputeId, signal),
    enabled: Boolean(disputeId) && role.isSuccess && Boolean(role.data)
  });

  useEffect(() => {
    if (!disputeId || !role.data) return;
    const client = getSupabaseClient();
    const channel = client.channel("merchant-order-dispute-" + disputeId)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "merchant_order_dispute_messages",
        filter: "dispute_id=eq." + disputeId
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute-messages", disputeId] });
        void queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute", disputeId] });
        void queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute-inbox"] });
      })
      .subscribe();
    const disputeChannel = client.channel("merchant-order-dispute-status-" + disputeId)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "merchant_order_disputes",
        filter: "id=eq." + disputeId
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute", disputeId] });
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
      void client.removeChannel(disputeChannel);
    };
  }, [disputeId, role.data, queryClient]);

  const refresh = async () => {
    await Promise.all([role.refetch(), dispute.refetch(), messages.refetch()]);
  };
  const sendMutation = useMutation({
    mutationFn: () => sendMerchantOrderDisputeMessage(disputeId, message, attachment),
    onSuccess: async () => {
      setMessage("");
      setAttachment(null);
      setAttachmentError(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute-messages", disputeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute", disputeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute-inbox"] })
      ]);
    }
  });
  const resolveMutation = useMutation({
    mutationFn: () => resolveMerchantOrderDispute(disputeId, resolutionNote),
    onSuccess: async () => {
      setResolutionNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute", disputeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-order-dispute-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-order-details"] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-order-details"] })
      ]);
    }
  });

  const chooseAttachment = async () => {
    setAttachmentError(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAttachmentError(true);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.82
      });
      if (!result.canceled && result.assets[0]) setAttachment(result.assets[0]);
    } catch {
      setAttachmentError(true);
    }
  };

  if (role.isPending || (role.data && (dispute.isPending || messages.isPending))) {
    return <CustomerScreen showNavigation={false}><AppHeader title={translate("disputeChatTitle")} /><PageSkeleton variant="details" rows={4} /></CustomerScreen>;
  }
  if (role.isError || dispute.isError || messages.isError) {
    return <CustomerScreen showNavigation={false}>
      <AppHeader title={translate("disputeChatTitle")} />
      <ErrorState title={translate("disputeLoadError")} retryLabel={translate("retry")} onRetry={() => { void refresh(); }} busy={role.isFetching || dispute.isFetching || messages.isFetching} />
    </CustomerScreen>;
  }
  if (!role.data || !dispute.data) {
    return <CustomerScreen showNavigation={false}>
      <AppHeader title={translate("disputeChatTitle")} />
      <EmptyState icon="message-circle" title={translate("disputeNotFound")} hint={translate("disputeNotFoundHint")} />
    </CustomerScreen>;
  }

  const isSupport = role.data === "support";
  const resolved = dispute.data.status === "resolved";
  const senderLabel = (senderRole: string) => senderRole === "support"
    ? translate("disputeSupport")
    : senderRole === "merchant" ? translate("disputeMerchant") : translate("disputeCustomer");

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <CustomerScreen
        showNavigation={false}
        onRefresh={() => { void refresh(); }}
        refreshing={role.isFetching || dispute.isFetching || messages.isFetching}
        footer={!resolved ? (
          <View style={styles.composer}>
            {attachment ? (
              <View style={styles.attachmentPreview}>
                <Image source={{ uri: attachment.uri }} style={styles.previewImage} />
                <PressableSurface accessibilityRole="button" accessibilityLabel={translate("disputeRemoveAttachment")} onPress={() => setAttachment(null)} style={styles.removeAttachment}>
                  <Icon name="x" size={16} color={theme.colors.foreground} />
                </PressableSurface>
              </View>
            ) : null}
            <View style={styles.composerRow}>
              <PressableSurface accessibilityRole="button" accessibilityLabel={translate("disputeAddAttachment")} onPress={() => { void chooseAttachment(); }} style={styles.attachButton}>
                <Icon name="paperclip" size={19} color={theme.colors.foregroundSecondary} />
              </PressableSurface>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={translate("disputeMessagePlaceholder")}
                placeholderTextColor={theme.colors.subtle}
                maxLength={4000}
                multiline
                textAlignVertical="center"
                style={styles.input}
                accessibilityLabel={translate("disputeMessagePlaceholder")}
              />
              <PressableSurface
                accessibilityRole="button"
                accessibilityLabel={translate("supportSend")}
                disabled={(!message.trim() && !attachment) || sendMutation.isPending}
                onPress={() => sendMutation.mutate()}
                style={[styles.sendButton, { backgroundColor: theme.colors.accent, opacity: (!message.trim() && !attachment) || sendMutation.isPending ? 0.45 : 1 }]}
              >
                <Icon name="send" size={18} color={theme.colors.accentForeground} />
              </PressableSurface>
            </View>
            {attachmentError ? <UiText tone="danger">{translate("disputeAttachmentError")}</UiText> : null}
            {sendMutation.isError ? <UiText tone="danger">{translate("disputeSendError")}</UiText> : null}
            <Caption>{translate("disputeChatSafetyHint")}</Caption>
          </View>
        ) : undefined}
      >
        <AppHeader
          title={translate("disputeChatTitle")}
          leading={<IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="arrow-right" size={22} color={theme.colors.foreground} />} variant="ghost" />}
        />
        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <UiText weight="800">{translate("orderDisputeTicket")}</UiText>
            <Caption>{translate(resolved ? "orderDisputeStatusResolved" : dispute.data.status === "in_review" ? "orderDisputeStatusInReview" : "orderDisputeStatusOpen")}</Caption>
          </View>
          <Caption>{translate("disputeReasonLabel")}</Caption>
          <UiText>{dispute.data.reason}</UiText>
          <Caption>{translate("orderDisputeOpenedAt")}: {dateLabel(dispute.data.created_at, language)}</Caption>
        </View>

        {(messages.data ?? []).length === 0 ? <EmptyState icon="message-circle" title={translate("disputeMessagesEmpty")} /> : null}
        {(messages.data ?? []).map((item) => {
          const own = item.sender_id === role.data;
          const isOwn = item.sender_role === role.data;
          return (
            <View key={item.id} style={[styles.message, isOwn ? styles.ownMessage : styles.otherMessage, { backgroundColor: isOwn ? theme.colors.accentMuted : theme.colors.surface }]}>
              <Caption style={{ color: theme.colors.foreground }}>{senderLabel(item.sender_role)}</Caption>
              {item.message ? <UiText style={{ color: theme.colors.foreground }}>{item.message}</UiText> : null}
              {item.attachment_url ? (
                <PressableSurface accessibilityRole="button" onPress={() => { void Linking.openURL(item.attachment_url as string); }} style={styles.attachmentLink}>
                  <Icon name="paperclip" size={16} color={theme.colors.foreground} />
                  <UiText style={{ color: theme.colors.foreground }}>{translate("disputeOpenAttachment")}</UiText>
                </PressableSurface>
              ) : null}
              <Caption style={{ color: theme.colors.foregroundSecondary }}>{dateLabel(item.created_at, language)}</Caption>
            </View>
          );
        })}

        {resolved ? (
          <Alert title={translate("orderDisputeStatusResolved")} description={dispute.data.resolution_note ?? ""} tone="success" />
        ) : null}
        {isSupport && !resolved ? (
          <View style={styles.resolvePanel}>
            <UiText weight="800">{translate("disputeResolveTitle")}</UiText>
            <TextArea
              value={resolutionNote}
              onChangeText={setResolutionNote}
              maxLength={2000}
              minHeight={100}
              placeholder={translate("disputeResolutionPlaceholder")}
              accessibilityLabel={translate("disputeResolutionPlaceholder")}
            />
            <Button
              label={translate("disputeResolveAction")}
              onPress={() => resolveMutation.mutate()}
              loading={resolveMutation.isPending}
              disabled={!resolutionNote.trim()}
              fullWidth
            />
            {resolveMutation.isError ? <UiText tone="danger">{translate("disputeResolveError")}</UiText> : null}
            <Caption>{translate("disputeSupportScopeHint")}</Caption>
          </View>
        ) : null}
      </CustomerScreen>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    root: { flex: 1 },
    summary: { padding: designTokens.spacing.md, borderRadius: designTokens.radius.md, backgroundColor: theme.colors.surfaceSecondary, gap: designTokens.spacing.xs },
    summaryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    message: { maxWidth: "88%", padding: designTokens.spacing.md, borderRadius: designTokens.radius.lg, gap: designTokens.spacing.xs },
    ownMessage: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
    otherMessage: { alignSelf: "flex-start", borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
    composer: { gap: designTokens.spacing.xs },
    composerRow: { flexDirection: "row", alignItems: "flex-end", gap: designTokens.spacing.xs },
    input: { flex: 1, minHeight: 44, maxHeight: 104, borderWidth: 1, borderColor: theme.colors.border, borderRadius: designTokens.radius.lg, paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm, color: theme.colors.foreground, backgroundColor: theme.colors.surface, textAlign: "auto", fontFamily: theme.fontFamilies.arabic },
    sendButton: { width: 44, height: 44, borderRadius: designTokens.radius.lg, alignItems: "center", justifyContent: "center" },
    attachButton: { width: 44, height: 44, borderRadius: designTokens.radius.lg, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
    attachmentPreview: { alignSelf: "flex-start", position: "relative" },
    previewImage: { width: 84, height: 84, borderRadius: designTokens.radius.md },
    removeAttachment: { position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
    attachmentLink: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs, paddingVertical: designTokens.spacing.xs },
    resolvePanel: { borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: designTokens.spacing.md, gap: designTokens.spacing.sm },
  });
}
