import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { CustomerScreen } from "@/components/customer-ui";
import { AppHeader, Card, Caption, Heading, Icon, PressableSurface, Text as UiText } from "@/components/ui";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";

export default function PrivacySecurityScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);

  return (
    <CustomerScreen showNavigation={false} contentStyle={styles.content}>
      <AppHeader
        title={translate("settingsPrivacyTitle")}
        leading={
          <PressableSurface accessibilityRole="button" accessibilityLabel={translate("back")} onPress={() => router.back()}>
            <Icon name="chevron-right" size={22} color={theme.colors.foreground} />
          </PressableSurface>
        }
      />
      <Heading level={3}>{translate("settingsPrivacyTitle")}</Heading>
      <Card contentStyle={styles.group}>
        <PrivacyRow icon="shield-check" label={translate("settingsPrivacyPolicy")} onPress={() => router.push("/privacy")} theme={theme} styles={styles} />
        <PrivacyRow icon="file-text" label={translate("settingsTermsOfUse")} onPress={() => router.push("/terms")} theme={theme} styles={styles} />
        <PrivacyRow icon="trash-2" label={translate("deleteAccountTitle")} onPress={() => router.push("/delete-account")} theme={theme} styles={styles} last destructive />
      </Card>
      <Caption>{translate("secureNote")}</Caption>
    </CustomerScreen>
  );
}

function PrivacyRow({
  icon,
  label,
  onPress,
  theme,
  styles,
  last = false,
  destructive = false
}: {
  icon: "shield-check" | "file-text" | "trash-2";
  label: string;
  onPress: () => void;
  theme: AppTheme;
  styles: ReturnType<typeof createStyles>;
  last?: boolean;
  destructive?: boolean;
}) {
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}
    >
      <View style={styles.rowLeading}>
        <Icon name={icon} size={19} color={destructive ? theme.colors.danger : theme.colors.foregroundSecondary} />
        <UiText weight="700" style={destructive ? { color: theme.colors.danger } : undefined}>{label}</UiText>
      </View>
      <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
    </PressableSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: { gap: designTokens.spacing.md },
    group: {
      paddingHorizontal: designTokens.spacing.md,
      paddingVertical: designTokens.spacing.xs,
      gap: 0,
      borderRadius: designTokens.radius.xl
    },
    row: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: designTokens.spacing.md,
      paddingVertical: designTokens.spacing.sm
    },
    rowLeading: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: designTokens.spacing.md
    }
  });
}
