import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { designTokens, useAppTheme } from "@/lib/theme";
import { translate } from "@/lib/i18n";
import { Icon, type IconName } from "./icon";
import { Text as UiText } from "./typography";

export type FeedbackTone = "info" | "success" | "warning" | "danger";

export function Alert({
  title,
  description,
  tone = "info",
  style
}: {
  title?: string;
  description: string;
  tone?: FeedbackTone;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const palette = {
    info: { foreground: theme.colors.infoText, background: theme.colors.infoSurface, border: theme.colors.infoBorder },
    success: { foreground: theme.colors.successText, background: theme.colors.successSurface, border: theme.colors.successBorder },
    warning: { foreground: theme.colors.warningText, background: theme.colors.warningSurface, border: theme.colors.warningBorder },
    danger: { foreground: theme.colors.dangerText, background: theme.colors.dangerSurface, border: theme.colors.dangerBorder }
  } satisfies Record<FeedbackTone, { foreground: string; background: string; border: string }>;
  const colors = palette[tone];

  return (
    <View accessibilityRole="alert" style={[{ padding: designTokens.spacing.md, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: designTokens.spacing.xs }, style]}>
      {title ? <UiText style={{ color: colors.foreground, fontWeight: theme.fontWeights.bold, fontSize: theme.typography.body, textAlign: "auto" }}>{title}</UiText> : null}
      <UiText style={{ color: theme.colors.foreground, fontSize: theme.typography.body, textAlign: "auto" }}>{description}</UiText>
    </View>
  );
}

export function Banner({
  children,
  action,
  style
}: {
  children: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.md, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accent }, style]}>
      <View style={{ flex: 1 }}>{children}</View>
      {action}
    </View>
  );
}

export function ProgressBar({
  value,
  max = 100,
  accessibilityLabel,
  style
}: {
  value: number;
  max?: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const progress = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max, now: Math.min(max, Math.max(0, value)) }}
      style={[{ height: 8, overflow: "hidden", borderRadius: theme.radius.pill, backgroundColor: theme.colors.border }, style]}
    >
      <View style={{ width: `${progress * 100}%`, height: "100%", borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent }} />
    </View>
  );
}

export function Spinner({ size = "small", color }: { size?: "small" | "large"; color?: string }) {
  const theme = useAppTheme();
  return <ActivityIndicator size={size} color={color ?? theme.colors.accentOnSurface} />;
}

export function Skeleton({
  width = "100%",
  height = 16,
  radius,
  style
}: {
  width?: ViewStyle["width"];
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return <View accessibilityElementsHidden style={[{ width, height, borderRadius: radius ?? theme.radius.sm, backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }, style]} />;
}


type SkeletonLayoutProps = {
  style?: StyleProp<ViewStyle>;
};

export function ProductCardSkeleton({ style }: SkeletonLayoutProps) {
  const theme = useAppTheme();
  return (
    <View accessibilityElementsHidden style={[{ flex: 1, gap: designTokens.spacing.sm, padding: designTokens.spacing.sm, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border, borderRadius: theme.radius.xl, backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface }, style]}>
      <Skeleton height={132} radius={theme.radius.lg} />
      <Skeleton width="82%" height={14} />
      <Skeleton width="58%" height={12} />
      <Skeleton width="44%" height={18} radius={theme.radius.md} />
    </View>
  );
}

export function StoreCardSkeleton({ style }: SkeletonLayoutProps) {
  const theme = useAppTheme();
  return (
    <View accessibilityElementsHidden style={[{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.md, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border, borderRadius: theme.radius.xl, backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface }, style]}>
      <Skeleton width={56} height={56} radius={theme.radius.pill} />
      <View style={{ flex: 1, gap: designTokens.spacing.sm }}>
        <Skeleton width="68%" height={14} />
        <Skeleton width="46%" height={12} />
        <Skeleton width="34%" height={10} />
      </View>
    </View>
  );
}

export function OrderCardSkeleton({ style }: SkeletonLayoutProps) {
  const theme = useAppTheme();
  return (
    <View accessibilityElementsHidden style={[{ gap: designTokens.spacing.md, padding: designTokens.spacing.md, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border, borderRadius: theme.radius.xl, backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md }}>
        <Skeleton width="42%" height={14} />
        <Skeleton width={76} height={24} radius={theme.radius.pill} />
      </View>
      <Skeleton width="64%" height={12} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md }}>
        <Skeleton width="30%" height={12} />
        <Skeleton width="24%" height={16} />
      </View>
    </View>
  );
}

export function MetricCardSkeleton({ style }: SkeletonLayoutProps) {
  const theme = useAppTheme();
  return (
    <View accessibilityElementsHidden style={[{ flex: 1, gap: designTokens.spacing.sm, padding: designTokens.spacing.md, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border, borderRadius: theme.radius.xl, backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface }, style]}>
      <Skeleton width="62%" height={12} />
      <Skeleton width="76%" height={26} />
      <Skeleton width="48%" height={10} />
    </View>
  );
}

export type PageSkeletonVariant = "list" | "form" | "profile" | "details" | "cart" | "checkout";

export function ProductFeedSkeleton({ style }: SkeletonLayoutProps) {
  const theme = useAppTheme();
  return (
    <View accessibilityElementsHidden style={[{ flex: 1, width: "100%", overflow: "hidden", backgroundColor: theme.colors.background }, style]}>
      <View style={{ flex: 3, minHeight: 0, backgroundColor: theme.colors.surfaceMuted, justifyContent: "flex-end", alignItems: "center", paddingBottom: designTokens.spacing.lg }}>
        <View style={{ flexDirection: "row", gap: designTokens.spacing.xs }}>
          <Skeleton width={16} height={6} radius={theme.radius.pill} />
          <Skeleton width={6} height={6} radius={theme.radius.pill} />
          <Skeleton width={6} height={6} radius={theme.radius.pill} />
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 0, justifyContent: "space-between", paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm, flex: 1 }}>
            <Skeleton width={36} height={36} radius={theme.radius.pill} />
            <Skeleton width="42%" height={12} />
          </View>
          <Skeleton width={64} height={12} />
        </View>
        <Skeleton width="76%" height={15} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md }}>
          <Skeleton width="24%" height={18} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm }}>
            <Skeleton width={104} height={40} radius={theme.radius.lg} />
            <Skeleton width={40} height={40} radius={theme.radius.pill} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function PageSkeleton({
  variant = "list",
  rows = 3,
  style
}: {
  variant?: PageSkeletonVariant;
  rows?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const count = Math.max(1, Math.min(rows, 6));
  const rowKeys = Array.from({ length: count }, (_, index) => index);

  return (
    <View accessibilityElementsHidden style={[{ width: "100%", gap: designTokens.spacing.lg, paddingVertical: designTokens.spacing.md }, style]}>
      {variant === "profile" ? (
        <View style={{ alignItems: "center", gap: designTokens.spacing.md, paddingVertical: designTokens.spacing.md }}>
          <Skeleton width={76} height={76} radius={theme.radius.pill} />
          <Skeleton width="42%" height={15} />
          <Skeleton width="58%" height={11} />
        </View>
      ) : variant === "details" ? (
        <>
          <Skeleton height={190} radius={theme.radius.lg} />
          <Skeleton width="72%" height={18} />
          <Skeleton width="44%" height={13} />
        </>
      ) : null}

      {variant === "cart" ? (
        <View style={{ gap: designTokens.spacing.md }}>
          {rowKeys.map((index) => (
            <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm, borderBottomWidth: index === count - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider }}>
              <Skeleton width={82} height={94} radius={theme.radius.lg} />
              <View style={{ flex: 1, gap: designTokens.spacing.sm }}>
                <Skeleton width="72%" height={14} />
                <Skeleton width="48%" height={11} />
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: designTokens.spacing.xs }}>
                  <Skeleton width="34%" height={16} />
                  <Skeleton width={76} height={30} radius={theme.radius.md} />
                </View>
              </View>
            </View>
          ))}
          <View style={{ gap: designTokens.spacing.md, paddingTop: designTokens.spacing.md }}>
            <Skeleton width="100%" height={48} radius={theme.radius.lg} />
            <Skeleton width="100%" height={48} radius={theme.radius.lg} />
          </View>
        </View>
      ) : variant === "checkout" ? (
        <View style={{ gap: designTokens.spacing.lg }}>
          <View style={{ gap: designTokens.spacing.md }}>
            <Skeleton width="42%" height={15} />
            <Skeleton width="100%" height={82} radius={theme.radius.lg} />
          </View>
          <View style={{ gap: designTokens.spacing.md }}>
            <Skeleton width="34%" height={15} />
            {rowKeys.slice(0, 2).map((index) => (
              <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md }}>
                <Skeleton width={58} height={58} radius={theme.radius.md} />
                <View style={{ flex: 1, gap: designTokens.spacing.sm }}>
                  <Skeleton width="68%" height={12} />
                  <Skeleton width="38%" height={11} />
                </View>
                <Skeleton width={54} height={13} />
              </View>
            ))}
          </View>
          <View style={{ gap: designTokens.spacing.md, paddingTop: designTokens.spacing.md }}>
            <Skeleton width="38%" height={15} />
            <Skeleton width="100%" height={48} radius={theme.radius.md} />
            <Skeleton width="100%" height={48} radius={theme.radius.md} />
            <Skeleton width="100%" height={52} radius={theme.radius.lg} />
          </View>
        </View>
      ) : variant === "form" ? (
        <View style={{ gap: designTokens.spacing.md }}>
          {rowKeys.map((index) => (
            <View key={index} style={{ gap: designTokens.spacing.sm }}>
              <Skeleton width={index % 2 === 0 ? "34%" : "46%"} height={12} />
              <Skeleton height={48} radius={theme.radius.md} />
            </View>
          ))}
        </View>
      ) : variant === "list" ? (
        <View style={{ gap: designTokens.spacing.md }}>
          {rowKeys.map((index) => (
            <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, paddingVertical: designTokens.spacing.xs }}>
              <Skeleton width={52} height={52} radius={theme.radius.md} />
              <View style={{ flex: 1, gap: designTokens.spacing.sm }}>
                <Skeleton width={index % 2 === 0 ? "68%" : "54%"} height={13} />
                <Skeleton width="88%" height={10} />
                <Skeleton width="36%" height={10} />
              </View>
            </View>
          ))}
        </View>
      ) : variant === "profile" ? (
        <View style={{ gap: designTokens.spacing.md }}>
          {rowKeys.slice(0, 3).map((index) => (
            <View key={index} style={{ gap: designTokens.spacing.sm, padding: designTokens.spacing.md, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSecondary }}>
              <Skeleton width="38%" height={12} />
              <Skeleton width="82%" height={13} />
              <Skeleton width="58%" height={11} />
            </View>
          ))}
        </View>
      ) : variant === "details" ? (
        <View style={{ gap: designTokens.spacing.md }}>
          <Skeleton width="100%" height={42} radius={theme.radius.md} />
          <Skeleton width="100%" height={74} radius={theme.radius.md} />
          <Skeleton width="62%" height={12} />
        </View>
      ) : null}
    </View>
  );
}

export function SuccessState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const theme = useAppTheme();
  return (
    <View style={{ minHeight: 144, alignItems: "center", justifyContent: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.xl }}>
      <View style={{ width: theme.dimensions.avatarSize.md, height: theme.dimensions.avatarSize.md, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.successSurface }}>
        <Icon name="check" size={24} color={theme.colors.success} accessibilityHidden />
      </View>
      <UiText accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: theme.typography.subtitle, fontWeight: theme.fontWeights.extrabold, textAlign: "center" }}>{title}</UiText>
      {description ? <UiText style={{ color: theme.colors.muted, fontSize: theme.typography.body, textAlign: "center" }}>{description}</UiText> : null}
      {action}
    </View>
  );
}

export function Dialog({
  visible,
  onRequestClose,
  title,
  description,
  children
}: {
  visible: boolean;
  onRequestClose: () => void;
  title?: string | undefined;
  description?: string | undefined;
  children?: ReactNode;
}) {
  const theme = useAppTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={{ flex: 1, justifyContent: "center", padding: designTokens.spacing.lg }}>
        <Pressable accessible={false} onPress={onRequestClose} style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.overlay }} />
        <View accessibilityViewIsModal style={{ padding: designTokens.spacing.lg, borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, gap: designTokens.spacing.md }}>
          {title ? <UiText accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: theme.typography.subtitle, fontWeight: theme.fontWeights.extrabold, textAlign: "auto" }}>{title}</UiText> : null}
          {description ? <UiText style={{ color: theme.colors.muted, fontSize: theme.typography.body, textAlign: "auto" }}>{description}</UiText> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function BottomSheet({
  visible,
  onRequestClose,
  title,
  children,
  closeIcon = "x",
  maxHeight = "85%",
  height
}: {
  visible: boolean;
  onRequestClose: () => void;
  title: string;
  children: ReactNode;
  closeIcon?: IconName;
  maxHeight?: ViewStyle["maxHeight"];
  height?: ViewStyle["height"];
}) {
  const theme = useAppTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRequestClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable accessible={false} onPress={onRequestClose} style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.overlay }} />
        <View accessibilityViewIsModal style={{ height, maxHeight, padding: designTokens.spacing.lg, paddingBottom: designTokens.spacing.xxl, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, backgroundColor: theme.colors.surface, gap: designTokens.spacing.md }}>
          <View style={{ width: theme.dimensions.avatarSize.md, height: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.border, alignSelf: "center" }} />
          <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translate("merchantModalClose")}
              onPress={onRequestClose}
              hitSlop={8}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name={closeIcon} size={20} color={theme.colors.foreground} accessibilityHidden />
            </Pressable>
            <View pointerEvents="none" style={{ position: "absolute", start: 52, end: 52, alignItems: "center", justifyContent: "center" }}>
              <UiText accessibilityRole="header" numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: theme.typography.body, fontWeight: theme.fontWeights.extrabold, textAlign: "center" }}>{title}</UiText>
            </View>
            <View style={{ width: 44, height: 44 }} />
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.divider }} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Toast({
  visible,
  message,
  action
}: {
  visible: boolean;
  message: string;
  action?: ReactNode;
}) {
  const theme = useAppTheme();
  if (!visible) return null;

  return (
    <View accessibilityRole="alert" pointerEvents="box-none" style={{ position: "absolute", start: designTokens.spacing.md, end: designTokens.spacing.md, bottom: designTokens.spacing.xl, alignItems: "center" }}>
      <View style={{ minHeight: theme.dimensions.controlHeight.lg, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm, paddingHorizontal: designTokens.spacing.lg, paddingVertical: designTokens.spacing.sm, borderRadius: theme.radius.pill, backgroundColor: theme.colors.foreground }}>
        <UiText style={{ color: theme.colors.surface, flex: 1, textAlign: "auto" }}>{message}</UiText>
        {action}
      </View>
    </View>
  );
}


export function ConfirmDialog({
  visible,
  onRequestClose,
  onConfirm,
  title,
  description,
  cancelLabel,
  confirmLabel,
  busy = false,
  destructive = false
}: {
  visible: boolean;
  onRequestClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <Dialog visible={visible} onRequestClose={onRequestClose} title={title} description={description}>
      <View style={{ flexDirection: "row", gap: designTokens.spacing.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel={cancelLabel} disabled={busy} onPress={onRequestClose} style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, opacity: busy ? 0.5 : 1 }}>
          <UiText style={{ color: theme.colors.foreground, fontWeight: theme.fontWeights.bold }}>{cancelLabel}</UiText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={confirmLabel} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onConfirm} style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.pill, backgroundColor: destructive ? theme.colors.danger : theme.colors.accent, opacity: busy ? 0.5 : 1 }}>
          {busy ? <ActivityIndicator color={destructive ? (theme.mode === "dark" ? theme.colors.accentForeground : theme.colors.surface) : theme.colors.accentForeground} /> : <UiText style={{ color: destructive ? (theme.mode === "dark" ? theme.colors.accentForeground : theme.colors.surface) : theme.colors.accentForeground, fontWeight: theme.fontWeights.bold }}>{confirmLabel}</UiText>}
        </Pressable>
      </View>
    </Dialog>
  );
}
