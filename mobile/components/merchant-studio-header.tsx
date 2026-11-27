import { View, StyleSheet } from "react-native";
import { Icon, IconButton, Text as UiText } from "@/components/ui";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

type MerchantStudioHeaderProps = { sectionTitle: string; onSettingsPress: () => void };

export function MerchantStudioHeader({ sectionTitle, onSettingsPress }: MerchantStudioHeaderProps) {
  const theme = useAppTheme();
  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <UiText style={[styles.title, { color: theme.colors.foreground }]}>Arownd Studio</UiText>
        <UiText style={[styles.subtitle, { color: theme.colors.muted }]}>{sectionTitle}</UiText>
      </View>
      <IconButton accessibilityLabel={translate("merchantAccountSettingsTitle")} onPress={onSettingsPress} icon={<Icon name="settings" size={19} color={theme.colors.foreground} />} variant="ghost" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: designTokens.typography.title, lineHeight: 26, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  subtitle: { fontSize: designTokens.typography.caption, lineHeight: 18, fontWeight: designTokens.fontWeights.medium, textAlign: "auto" }
});
