import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text as UiText } from "./typography";
import { Icon } from "./icon";
import { router } from "expo-router";
import { translate, useLanguage } from "@/lib/i18n";

import { designTokens, useAppTheme } from "@/lib/theme";

export function AppHeader({
  title,
  leading,
  trailing,
  showBackButton = true,
  onBack,
  style
}: {
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  showBackButton?: boolean;
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const { language } = useLanguage();
  const shouldShowBackButton = showBackButton || Boolean(leading);

  return (
    <View style={[styles.header, { gap: theme.spacing.md }, style]}>
      {shouldShowBackButton ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("back")}
          onPress={onBack ?? (() => router.back())}
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Icon name={language === "ar" ? "arrow-right" : "arrow-left"} size={20} color={theme.colors.foreground} />
        </Pressable>
      ) : null}
      <UiText
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.headerTitle, { color: theme.colors.foreground, fontSize: theme.typography.title }]}
      >
        {title}
      </UiText>
      <View style={[styles.slot, styles.trailing]}>{trailing}</View>
    </View>
  );
}

export type SegmentedOption = {
  key: string;
  label: string;
  accessibilityLabel?: string;
};

export function SegmentedControl({
  options,
  value,
  onChange,
  accessibilityLabel,
  style
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.segmented,
        { backgroundColor: "transparent", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
        style
      ]}
    >
      {options.map((option) => {
        const selected = option.key === value;

        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(option.key);
            }}
            style={({ pressed }) => [
              styles.segment,
              {
                borderRadius: 0,
                backgroundColor: "transparent",
                borderBottomWidth: selected ? 2 : 0,
                borderBottomColor: theme.colors.accent,
                opacity: pressed ? 0.75 : 1
              }
            ]}
          >
            <UiText
              numberOfLines={1}
              style={{
                color: selected ? theme.colors.accent : theme.colors.muted,
                fontSize: theme.typography.body,
                fontWeight: selected ? theme.fontWeights.bold : theme.fontWeights.medium
              }}
            >
              {option.label}
            </UiText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  header: {
    minHeight: designTokens.dimensions.controlHeight.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  slot: {
    minWidth: designTokens.dimensions.controlHeight.sm,
    alignItems: "center",
    justifyContent: "center"
  },
  trailing: {
    flexDirection: "row",
    gap: designTokens.spacing.sm
  },
  headerTitle: {
    flex: 1,
    textAlign: "auto",
    fontWeight: designTokens.fontWeights.extrabold
  },
  segmented: {
    flexDirection: "row",
    alignItems: "center",
    padding: 0,
    gap: 0
  },
  segment: {
    flex: 1,
    minHeight: designTokens.dimensions.controlHeight.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: designTokens.spacing.sm,
    paddingVertical: designTokens.spacing.sm
  }
});
