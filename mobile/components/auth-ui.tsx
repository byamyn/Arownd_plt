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
      <View pointerEvents="none" style={styles.backgroundLayer}>
        <SvgXml
          xml={AUTH_BACKGROUND.replace("#FAF9F5", theme.colors.background)}
          width="100%"
          height="100%"
        />
      </View>
      <KeyboardAvoidingView style={styles.keyboardLayer} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
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

export function AuthCountrySelector({
  label,
  value,
  onPress
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const theme = useAppTheme();

  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={[
        styles.countrySelector,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }
      ]}
    >
      <View style={styles.countrySelectorCopy}>
        <Caption>{label}</Caption>
        <UiText weight="700">{value}</UiText>
      </View>
      <Icon name="chevron-left" color={theme.colors.muted} size={designTokens.dimensions.iconSize.md} />
    </PressableSurface>
  );
}

export function AuthStepIndicator({ currentStep }: { currentStep: 1 | 2 }) {
  const theme = useAppTheme();
  const steps = [
    { number: 1, label: translate("authStepAccountType") },
    { number: 2, label: translate("authStepDetails") }
  ] as const;

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={translate("authStepProgress")} style={styles.stepIndicator}>
      {steps.map((step, index) => {
        const complete = step.number < currentStep;
        const active = step.number === currentStep;
        const emphasized = complete || active;
        return (
          <View key={step.number} style={styles.stepGroup}>
            <View style={styles.stepItem}>
              <View style={[
                styles.stepNumber,
                {
                  backgroundColor: complete ? theme.colors.accent : "transparent",
                  borderColor: emphasized ? theme.colors.accent : theme.colors.border
                }
              ]}>
                <UiText weight="700" style={{ color: complete ? theme.colors.surface : emphasized ? theme.colors.accent : theme.colors.muted }}>
                  {complete ? "✓" : String(step.number)}
                </UiText>
              </View>
              <Caption weight={active ? "800" : "600"} style={{ color: emphasized ? theme.colors.foreground : theme.colors.muted }}>
                {step.label}
              </Caption>
            </View>
            {index === 0 ? (
              <View style={[styles.stepConnector, { backgroundColor: currentStep === 2 ? theme.colors.accent : theme.colors.border }]} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const theme = useAppTheme();
  if (!password) return null;

  const passwordLength = Array.from(password).length;
  const hasNumber = /\p{N}/u.test(password);
  const hasSymbol = /[\p{P}\p{S}]/u.test(password);
  const rules = [
    { key: "passwordRuleMin", met: passwordLength >= 8 },
    { key: "passwordRuleLong", met: passwordLength >= 12 },
    { key: "passwordRuleMixedCase", met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { key: "passwordRuleNumberSymbol", met: hasNumber && hasSymbol }
  ] as const;
  const score = rules.filter((rule) => rule.met).length;
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
      <View style={styles.passwordRules}>
        {rules.map((rule) => (
          <View key={rule.key} style={styles.passwordRule}>
            <View style={[
              styles.passwordRuleMark,
              { borderColor: rule.met ? theme.colors.success : theme.colors.border, backgroundColor: rule.met ? theme.colors.success : "transparent" }
            ]}>
              {rule.met ? <UiText style={styles.passwordRuleCheck}>✓</UiText> : null}
            </View>
            <Caption style={{ color: rule.met ? theme.colors.success : theme.colors.muted }}>
              {translate(rule.key)}
            </Caption>
          </View>
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

// Artwork based on the repository's root arownd-background.svg asset.
// The background color is replaced at render time to follow the active app theme.
const AUTH_BACKGROUND = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">
  <rect width="390" height="844" fill="#FAF9F5"/>
  <g transform="translate(-96 -56) scale(12.5)" opacity="0.09">
    <path d="M12 2C17 2 21 10 21 19C21 25 17 30 12 30C7 30 3 25 3 19C3 10 7 2 12 2Z" fill="none" stroke="#D97757" stroke-width="1" stroke-linejoin="round"/>
    <circle cx="12" cy="20" r="4.5" fill="#D97757"/>
  </g>
</svg>`;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  keyboardLayer: { flex: 1, zIndex: 1, elevation: 1 },
  backgroundLayer: { ...StyleSheet.absoluteFill, zIndex: 0, elevation: 0 },
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
  countrySelector: { minHeight: 58, paddingHorizontal: designTokens.spacing.md, borderWidth: 1, borderRadius: designTokens.radius.lg - 3, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
  countrySelectorCopy: { flex: 1, gap: designTokens.spacing.xs },
  stepIndicator: { flexDirection: "row", alignItems: "center", marginBottom: designTokens.spacing.md },
  stepGroup: { flex: 1, flexDirection: "row", alignItems: "center" },
  stepItem: { alignItems: "center", gap: designTokens.spacing.xs, minWidth: 94 },
  stepNumber: { width: 28, height: 28, borderRadius: designTokens.radius.pill, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  stepConnector: { flex: 1, height: 1, marginHorizontal: designTokens.spacing.sm },
  passwordStrength: { gap: designTokens.spacing.xs, marginTop: -designTokens.spacing.sm },
  passwordStrengthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  passwordStrengthBars: { flexDirection: "row", gap: designTokens.spacing.xs },
  passwordStrengthBar: { flex: 1, height: 4, borderRadius: designTokens.radius.pill },
  passwordRules: { gap: designTokens.spacing.xs, paddingTop: designTokens.spacing.xs },
  passwordRule: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  passwordRuleMark: { width: 16, height: 16, borderRadius: designTokens.radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  passwordRuleCheck: { color: "#FFFFFF", fontSize: 10, lineHeight: 12, fontWeight: "800" },
  footer: { marginTop: "auto", paddingTop: designTokens.spacing.xxl }
});
