import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInputProps
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { router } from "expo-router";

import Logo from "@/components/logo";
import {
  Alert,
  Button,
  Caption,
  Heading,
  Icon,
  IconButton,
  PressableSurface,
  SuccessState,
  Text as UiText,
  TextField
} from "@/components/ui";
import { translate, type TranslationKey } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";
import type { IconName } from "@/components/ui";

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  showBack?: boolean;
};

export function AuthLayout({ title, subtitle, children, showBack = false }: AuthLayoutProps) {
  const theme = useAppTheme();

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/login");
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <SvgXml
        pointerEvents="none"
        xml={AVOCADO_WATERMARK}
        width={220}
        height={260}
        style={styles.avocadoWatermark}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {showBack ? (
              <IconButton
                accessibilityLabel={translate("back")}
                onPress={handleBack}
                icon={<Icon name="chevron-right" color={theme.colors.foreground} size={designTokens.dimensions.iconSize.md} />}
                variant="surface"
                size={designTokens.dimensions.controlHeight.md}
              />
            ) : <View style={styles.backPlaceholder} />}
            <Logo color={theme.colors.foreground} width={160} />
            <View style={styles.backPlaceholder} />
          </View>

          <View style={styles.hero}>
            <Caption tone="accentMuted" weight="800" style={styles.eyebrow}>
              {translate("authEyebrow")}
            </Caption>
            <Heading level={1} align="right" style={styles.title}>{title}</Heading>
            <Caption tone="muted" style={styles.subtitle}>{subtitle}</Caption>
          </View>

          <View style={styles.content}>{children}</View>
          <Caption tone="muted" align="center" style={styles.footer}>
            {translate("secureNote")}
          </Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = TextInputProps & { label: string; error?: string | undefined; icon?: IconName };

export function AuthField({ label, error, style, icon, ...props }: FieldProps) {
  const isEmail = props.keyboardType === "email-address";

  return (
    <View style={styles.authFieldContainer}>
      <TextField
        {...props}
        label={label}
        error={error}
        textAlign={isEmail || props.secureTextEntry ? "right" : "auto"}
        autoCapitalize={isEmail ? "none" : props.autoCapitalize}
        focusEmphasis
        style={[styles.authFieldInput, style]}
      />
      {icon ? (
        <View pointerEvents="none" style={styles.authFieldIcon}>
          <Icon name={icon} size={19} color="#77756D" />
        </View>
      ) : null}
    </View>
  );
}

type ActionButtonProps = { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; startIcon?: ReactNode };

export function ActionButton({ label, onPress, loading = false, disabled = false, startIcon }: ActionButtonProps) {
  return (
    <Button
      label={label}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      fullWidth
      size="lg"
      startIcon={startIcon}
    />
  );
}

export function InlineLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableSurface accessibilityRole="link" onPress={onPress} hitSlop={8}>
      <UiText weight="700" tone="accentMuted" style={styles.link}>{label}</UiText>
    </PressableSurface>
  );
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const theme = useAppTheme();
  if (!password) return null;

  const passwordLength = Array.from(password).length;
  const hasNumber = /\p{N}/u.test(password);
  const hasSymbol = /[\p{P}\p{S}]/u.test(password);
  const score = [
    passwordLength >= 8,
    passwordLength >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    hasNumber && hasSymbol
  ].filter(Boolean).length;
  const labelKey = score <= 1
    ? "passwordStrengthWeak"
    : score === 2
      ? "passwordStrengthFair"
      : score === 3
        ? "passwordStrengthGood"
        : "passwordStrengthStrong";
  const strengthColor = score <= 1
    ? theme.colors.danger
    : score === 2
      ? theme.colors.warning
      : score === 3
        ? theme.colors.accent
        : theme.colors.success;

  return (
    <View accessibilityLabel={`${translate("passwordStrength")}: ${translate(labelKey)}`} style={styles.passwordStrength}>
      <View style={styles.passwordStrengthHeader}>
        <Caption tone="muted">{translate("passwordStrength")}</Caption>
        <Caption style={{ color: strengthColor }} weight="700">{translate(labelKey)}</Caption>
      </View>
      <View style={styles.passwordStrengthBars}>
        {[1, 2, 3, 4].map((segment) => (
          <View
            key={segment}
            style={[
              styles.passwordStrengthBar,
              { backgroundColor: segment <= score ? strengthColor : theme.colors.border }
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export function FormError({ message }: { message: string }) {
  return <Alert description={message} tone="danger" />;
}

export function SuccessPanel({ title, message }: { title: string; message: string }) {
  return <SuccessState title={title} description={message} />;
}

export function translateError(key: TranslationKey): string {
  return translate(key);
}

const AVOCADO_WATERMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 260"><path d="M110 12C85 12 72 42 57 72C38 111 18 150 35 190C48 222 78 246 110 246C142 246 172 222 185 190C202 150 182 111 163 72C148 42 135 12 110 12Z" fill="none" stroke="#D97757" stroke-width="9"/><ellipse cx="110" cy="158" rx="28" ry="39" fill="none" stroke="#D97757" stroke-width="8"/></svg>`;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avocadoWatermark: { position: "absolute", top: 138, right: -62, opacity: 0.09 },
  authFieldContainer: { position: "relative" },
  authFieldInput: { paddingRight: 54 },
  authFieldIcon: { position: "absolute", right: designTokens.spacing.md, top: 0, bottom: 0, justifyContent: "center" },
  safeArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: designTokens.spacing.xl,
    paddingTop: designTokens.spacing.md,
    paddingBottom: designTokens.spacing.xxl
  },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  backPlaceholder: {
    width: designTokens.dimensions.controlHeight.md,
    height: designTokens.dimensions.controlHeight.md
  },
  hero: {
    marginTop: designTokens.spacing.xxl + designTokens.spacing.sm,
    marginBottom: designTokens.spacing.xxl,
    alignItems: "flex-start"
  },
  eyebrow: { marginBottom: designTokens.spacing.md },
  title: { textAlign: "auto" },
  subtitle: { textAlign: "auto", marginTop: designTokens.spacing.sm },
  content: { gap: designTokens.spacing.lg },
  link: { fontSize: designTokens.typography.caption + 2 },
  passwordStrength: { gap: designTokens.spacing.xs, marginTop: -designTokens.spacing.sm },
  passwordStrengthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  passwordStrengthBars: { flexDirection: "row", gap: designTokens.spacing.xs },
  passwordStrengthBar: { flex: 1, height: 4, borderRadius: designTokens.radius.pill },
  footer: { marginTop: "auto", paddingTop: designTokens.spacing.xxl }
});
