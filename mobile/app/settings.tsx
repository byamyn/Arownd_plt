import { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";
import { isThemeMode, useThemePreference } from "@/lib/design-system";
import { CustomerScreen } from "@/components/customer-ui";
import {
  AppHeader,
  BottomSheet,
  Button,
  Caption,
  Card,
  ConfirmDialog,
  Heading,
  Icon,
  PressableSurface,
  SegmentedControl,
  Text as UiText,
  TextField,
  type IconName
} from "@/components/ui";
import { translate, useLanguage } from "@/lib/i18n";
import { resetPasswordSchema } from "@/lib/auth-validation";
import { getSupabaseClient } from "@/lib/supabase";
import { getSavedAccountsSnapshot, removeSavedAccount, saveCurrentAccountSession, switchToSavedAccount } from "@/lib/saved-accounts";
import { unregisterCurrentPushDevice } from "@/lib/push-notifications";
import { BROWSING_CURRENCY_QUERY_KEY, fetchCountries, fetchMyBrowsingCountryCode, updateBrowsingCountryCode, type Country } from "@/lib/country-service";

type SettingsSheet = "password" | "appearance" | "language" | "country" | "accounts" | null;

export default function SettingsScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const { mode: themeMode, setMode: setThemeMode } = useThemePreference();
  const { language, setLanguage } = useLanguage();
  const [activeSheet, setActiveSheet] = useState<SettingsSheet>(null);
  const [appearanceError, setAppearanceError] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const passwordStrength = getPasswordStrength(password);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [accountSwitchError, setAccountSwitchError] = useState(false);
  const [addAccountError, setAddAccountError] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const countries = useQuery({ queryKey: ["available-countries"], queryFn: ({ signal }) => fetchCountries(signal), enabled: activeSheet === "country" });
  const browsingCountry = useQuery({ queryKey: ["browsing-country"], queryFn: ({ signal }) => fetchMyBrowsingCountryCode(signal) });
  const savedAccounts = useQuery({
    queryKey: ["saved-accounts"],
    queryFn: getSavedAccountsSnapshot,
    enabled: activeSheet === "accounts",
    staleTime: 0
  });
  const browsingCountryMutation = useMutation({
    mutationFn: updateBrowsingCountryCode,
    onSuccess: async (_data, countryCode) => {
      setFormError(null);
      queryClient.setQueryData(["browsing-country"], countryCode);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BROWSING_CURRENCY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["customer-home-products"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-explore-products"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-market-regions"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-stores-by-region"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-featured-stores"] }),
        queryClient.invalidateQueries({ queryKey: ["map-stores"] })
      ]);
      closeSheet();
    },
    onError: () => setFormError(translate("settingsCountrySaveError"))
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!currentPassword) throw new Error("passwordCurrentRequired");
      const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "passwordInvalid");
      const client = getSupabaseClient();
      const { data: currentUserData, error: currentUserError } = await client.auth.getUser();
      const currentUser = currentUserData.user;
      if (currentUserError || !currentUser?.email) throw new Error("passwordCurrentInvalid");

      const { data: reauthenticated, error: reauthenticationError } = await client.auth.signInWithPassword({
        email: currentUser.email,
        password: currentPassword
      });
      if (reauthenticationError || reauthenticated.user?.id !== currentUser.id) {
        throw new Error("passwordCurrentInvalid");
      }

      const { error } = await client.auth.updateUser({
        password: parsed.data.password,
        current_password: currentPassword
      });
      if (error) {
        if (error.code === "current_password_mismatch" || error.code === "current_password_required") {
          throw new Error("passwordCurrentInvalid");
        }
        throw error;
      }
    },
    onSuccess: () => {
      setFormError(null);
      setMessage(translate("settingsPasswordSaved"));
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
    },
    onError: (error: Error) => {
      setMessage(null);
      setFormError(error.message === "passwordCurrentRequired" || error.message === "passwordCurrentInvalid"
        ? translate("passwordCurrentInvalid")
        : error.message === "passwordMin"
        ? translate("passwordMin")
        : error.message === "passwordMismatch"
          ? translate("passwordMismatch")
          : error.message === "required"
            ? translate("required")
            : translate("settingsPasswordError"));
    }
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const client = getSupabaseClient();
      const { data } = await client.auth.getSession();
      await unregisterCurrentPushDevice();
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      if (data.session?.user) await removeSavedAccount(data.session.user.id).catch(() => undefined);
    },
    onSuccess: async () => {
      await queryClient.clear();
      router.replace("/login");
    },
    onError: () => setSignOutError(true)
  });

  const openSheet = (sheet: Exclude<SettingsSheet, null>) => {
    setActiveSheet(sheet);
    setFormError(null);
    setMessage(null);
    if (sheet === "country") setCountrySearch("");
  };
  const closeSheet = () => setActiveSheet(null);
  const switchAccount = async (userId: string) => {
    setSwitchingAccount(true);
    setAccountSwitchError(false);
    try {
      await switchToSavedAccount(userId);
      await queryClient.clear();
      closeSheet();
      router.replace("/home");
    } catch {
      setAccountSwitchError(true);
    } finally {
      setSwitchingAccount(false);
    }
  };

  const addAccount = async () => {
    setAddingAccount(true);
    setAccountSwitchError(false);
    setAddAccountError(false);
    try {
      await saveCurrentAccountSession();
      closeSheet();
      router.push("/login");
    } catch {
      setAddAccountError(true);
    } finally {
      setAddingAccount(false);
    }
  };

  return (
    <CustomerScreen showNavigation={false} contentStyle={styles.screenContent} refreshing={browsingCountry.isFetching || (activeSheet === "country" && countries.isFetching)} onRefresh={() => { void browsingCountry.refetch(); if (activeSheet === "country") void countries.refetch(); }}>
      <AppHeader title={translate("settingsTitle")} />
      <View style={styles.section}>
        <Heading level={3}>{translate("settingsPreferencesTitle")}</Heading>
        <View style={styles.preferenceGrid}>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={translate("settingsBrowsingCountry")}
            onPress={() => openSheet("country")}
            style={styles.preferenceCard}
          >
            <View style={styles.preferenceIconBadge}><Icon name="map-pin" size={18} color={theme.colors.accentForeground} /></View>
            <View style={styles.preferenceCopy}>
              <UiText weight="700" numberOfLines={1}>{translate("settingsBrowsingCountry")}</UiText>
              <Caption numberOfLines={1}>{browsingCountry.data ?? "—"}</Caption>
            </View>
          </PressableSurface>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={translate("settingsAppearanceTitle")}
            onPress={() => openSheet("appearance")}
            style={styles.preferenceCard}
          >
            <View style={styles.preferenceIconBadge}><Icon name={theme.mode === "dark" ? "moon" : "sun"} size={18} color={theme.colors.accentForeground} /></View>
            <View style={styles.preferenceCopy}>
              <UiText weight="700" numberOfLines={1}>{translate("settingsAppearanceTitle")}</UiText>
              <Caption numberOfLines={1}>{translate(themeMode === "system" ? "settingsThemeSystem" : themeMode === "light" ? "settingsThemeLight" : "settingsThemeDark")}</Caption>
            </View>
          </PressableSurface>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={translate("settingsLanguageTitle")}
            onPress={() => openSheet("language")}
            style={styles.preferenceCard}
          >
            <View style={styles.preferenceIconBadge}><Icon name="globe" size={18} color={theme.colors.accentForeground} /></View>
            <View style={styles.preferenceCopy}>
              <UiText weight="700" numberOfLines={1}>{translate("settingsLanguageTitle")}</UiText>
              <Caption numberOfLines={1}>{translate(language === "ar" ? "settingsLanguageArabic" : "settingsLanguageEnglish")}</Caption>
            </View>
          </PressableSurface>
        </View>
      </View>

      <View style={styles.section}>
        <Heading level={3}>{translate("settingsAppSection")}</Heading>
        <Card contentStyle={styles.sectionContent}>
          <SettingsRow
            icon="bell"
            label={translate("notificationsTitle")}
            onPress={() => router.push("/notifications")}
            theme={theme}
            styles={styles}
          />
          <SettingsRow
            icon="lock"
            label={translate("settingsPasswordChangeTitle")}
            onPress={() => openSheet("password")}
            theme={theme}
            styles={styles}
            last
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Heading level={3}>{translate("settingsSupportSection")}</Heading>
        <Card contentStyle={styles.sectionContent}>
          <SettingsRow
            icon="message-circle"
            label={translate("settingsSupportTitle")}
            onPress={() => router.push("/support")}
            theme={theme}
            styles={styles}
          />
          <SettingsRow
            icon="info"
            label={translate("settingsAboutTitle")}
            onPress={() => router.push("/about")}
            theme={theme}
            styles={styles}
            last
          />
        </Card>
      </View>

      <View style={styles.section}>
        <PressableSurface
          accessibilityRole="button"
          accessibilityLabel={translate("settingsPrivacyTitle")}
          onPress={() => router.push("/privacy-security")}
          style={styles.linkRow}
        >
          <View style={styles.linkLabel}>
            <View style={styles.iconBadge}><Icon name="lock" size={19} color={theme.colors.accentOnSurface} /></View>
            <View style={styles.privacyRowCopy}>
              <UiText weight="700">{translate("settingsPrivacyTitle")}</UiText>
              <Caption>{translate("settingsPrivacyPolicy")} · {translate("settingsTermsOfUse")}</Caption>
            </View>
          </View>
          <View style={styles.rowTrailing}><Icon name="chevron-left" size={18} color={theme.colors.subtle} /></View>
        </PressableSurface>
      </View>

      <View style={styles.section}>
        <SettingsRow
          icon="refresh-cw"
          label={translate("settingsSwitchAccount")}
          onPress={() => {
            setAccountSwitchError(false);
            setAddAccountError(false);
            openSheet("accounts");
          }}
          theme={theme}
          styles={styles}
          last
        />
        <PressableSurface
          accessibilityRole="button"
          accessibilityLabel={translate("settingsSignOutConfirmAction")}
          onPress={() => {
            setSignOutError(false);
            setSignOutConfirmOpen(true);
          }}
          disabled={signOutMutation.isPending}
          style={styles.signOutRow}
        >
          <View style={styles.linkLabel}>
            <Icon name="log-out" size={19} color={theme.colors.danger} />
            <UiText tone="danger" weight="700">{translate("settingsSignOutConfirmAction")}</UiText>
          </View>
          <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
        </PressableSurface>
        {signOutError ? <UiText tone="danger">{translate("settingsSignOutError")}</UiText> : null}
      </View>

      <BottomSheet visible={activeSheet === "accounts"} onRequestClose={closeSheet} title={translate("settingsSwitchAccount")}>
        <Caption>{translate("settingsSwitchAccountHint")}</Caption>
        {savedAccounts.isPending ? (
          <Caption>{translate("stateLoading")}</Caption>
        ) : savedAccounts.isError ? (
          <UiText tone="danger">{translate("settingsAccountsLoadError")}</UiText>
        ) : (
          <View style={styles.accountList}>
            {(savedAccounts.data?.accounts ?? []).map((account) => {
              const isCurrent = account.id === savedAccounts.data?.currentUserId;
              return (
                <PressableSurface
                  key={account.id}
                  accessibilityRole="button"
                  accessibilityLabel={account.email}
                  accessibilityState={{ selected: isCurrent, disabled: isCurrent || switchingAccount || addingAccount }}
                  onPress={() => {
                    if (!isCurrent) {
                      setAccountSwitchError(false);
                      void switchAccount(account.id);
                    }
                  }}
                  disabled={isCurrent || switchingAccount || addingAccount}
                  style={[styles.accountOption, isCurrent && { borderColor: theme.colors.accent, backgroundColor: theme.colors.surfaceSecondary }]}
                >
                  <View style={styles.accountAvatar}>
                    <Icon name="user" size={20} color={theme.colors.accentOnSurface} />
                  </View>
                  <View style={styles.accountOptionCopy}>
                    <UiText weight="700" numberOfLines={1}>{account.displayName}</UiText>
                    <Caption numberOfLines={1}>{account.email}</Caption>
                    {isCurrent ? <Caption style={{ color: theme.colors.success }}>{translate("settingsCurrentAccount")}</Caption> : null}
                  </View>
                  {isCurrent ? (
                    <Icon name="circle-check" size={20} color={theme.colors.success} />
                  ) : (
                    <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
                  )}
                </PressableSurface>
              );
            })}
            {(savedAccounts.data?.accounts.length ?? 0) <= 1 ? (
              <Caption>{translate("settingsNoSavedAccounts")}</Caption>
            ) : null}
          </View>
        )}
        {switchingAccount ? <Caption>{translate("settingsAccountSwitching")}</Caption> : null}
        {accountSwitchError ? <UiText tone="danger">{translate("settingsAccountSwitchError")}</UiText> : null}
        {addAccountError ? <UiText tone="danger">{translate("settingsAddAccountError")}</UiText> : null}
        <Button
          label={translate("settingsAddAccount")}
          startIcon={<Icon name="plus" size={16} color={theme.colors.foreground} />}
          onPress={() => void addAccount()}
          loading={addingAccount}
          disabled={addingAccount || switchingAccount}
          fullWidth
          variant="outline"
        />
      </BottomSheet>

      <BottomSheet visible={activeSheet === "password"} onRequestClose={closeSheet} title={translate("settingsPasswordChangeTitle")}>
        <Caption>{translate("settingsPasswordHint")}</Caption>
        <TextField
          value={currentPassword}
          onChangeText={(value) => {
            setCurrentPassword(value);
            setFormError(null);
            setMessage(null);
          }}
          placeholder={translate("currentPassword")}
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          style={styles.input}
        />
        <TextField
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setFormError(null);
            setMessage(null);
          }}
          placeholder={translate("newPassword")}
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
          style={styles.input}
        />
        <View style={styles.passwordStrength}>
          <Caption>{translate("passwordMin")}</Caption>
          <View style={styles.strengthHeader}>
            <Caption>{translate("passwordStrength")}: {translate(passwordStrengthLabel(passwordStrength))}</Caption>
            <View style={styles.strengthBars}>
              {[0, 1, 2, 3].map((index) => (
                <View
                  key={index}
                  style={[
                    styles.strengthBar,
                    index < passwordStrength && {
                      backgroundColor: passwordStrength >= 3 ? theme.colors.success : theme.colors.accent
                    }
                  ]}
                />
              ))}
            </View>
          </View>
        </View>
        <TextField
          value={confirmPassword}
          onChangeText={(value) => {
            setConfirmPassword(value);
            setFormError(null);
            setMessage(null);
          }}
          placeholder={translate("confirmPassword")}
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
          style={styles.input}
        />
        {formError ? <UiText tone="danger">{formError}</UiText> : null}
        {message ? <UiText tone="success" weight="700">{message}</UiText> : null}
        <Button
          label={translate("settingsPasswordSave")}
          onPress={() => passwordMutation.mutate()}
          loading={passwordMutation.isPending}
          disabled={passwordMutation.isPending || !currentPassword || !password || !confirmPassword}
          fullWidth
        />
      </BottomSheet>

      <BottomSheet visible={activeSheet === "country"} onRequestClose={closeSheet} title={translate("settingsBrowsingCountry")}>
        <Caption>{translate("settingsBrowsingCountryHint")}</Caption>
        <Caption>{translate("settingsBrowsingCountryImpact")}</Caption>
        {countries.isPending || browsingCountry.isPending ? <Caption>{translate("stateLoading")}</Caption> : countries.isError || browsingCountry.isError ? <UiText tone="danger">{translate("settingsCountryLoadError")}</UiText> : (
          <View style={styles.sheetContent}>
            <TextField
              value={countrySearch}
              onChangeText={setCountrySearch}
              placeholder={translate("settingsCountrySearch")}
              autoCapitalize="none"
              style={styles.countrySearch}
            />
            {(countries.data ?? []).filter((country: Country) => {
              if (!country.is_enabled) return false;
              const name = language === "ar" ? country.name_ar : country.name_en ?? country.name_ar;
              const currencySymbol = getCurrencySymbol(country.currency_code);
              const haystack = [name, country.code, country.currency_code, country.currency_name_ar, country.currency_name_en, currencySymbol].filter(Boolean).join(" ").toLocaleLowerCase();
              return haystack.includes(countrySearch.trim().toLocaleLowerCase());
            }).map((country) => {
              const selected = browsingCountry.data === country.code;
              const countryName = language === "ar" ? country.name_ar : country.name_en ?? country.name_ar;
              const currencySymbol = getCurrencySymbol(country.currency_code);
              const currencyLabel = language === "ar" ? `${country.currency_name_ar ?? country.currency_code} · ${currencySymbol}` : `${country.currency_code} · ${currencySymbol}`;
              return <PressableSurface key={country.code} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setFormError(null); if (!selected) browsingCountryMutation.mutate(country.code); }} style={[styles.languageOption, selected && { borderWidth: 1, borderColor: theme.colors.accent, backgroundColor: theme.colors.accent }]}>
                <View style={styles.countryOptionCopy}>
                  <UiText weight="700" style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground }}>{country.flag_emoji ?? "🌐"}  {countryName}</UiText>
                  <Caption style={{ color: selected ? theme.colors.accentForeground : theme.colors.foregroundSecondary }}>{currencyLabel}</Caption>
                </View>
                {selected ? <Icon name="circle-check" size={19} color={theme.colors.accentForeground} /> : null}
              </PressableSurface>;
            })}
          </View>
        )}
        {formError ? <UiText tone="danger">{formError}</UiText> : null}
        {browsingCountryMutation.isPending ? <Caption>{translate("stateLoading")}</Caption> : null}
      </BottomSheet>

      <BottomSheet visible={activeSheet === "appearance"} onRequestClose={closeSheet} title={translate("settingsAppearanceTitle")}>
        <Caption>{translate("settingsAppearanceHint")}</Caption>
        <SegmentedControl
          accessibilityLabel={translate("settingsAppearanceTitle")}
          value={themeMode}
          onChange={(value) => {
            if (!isThemeMode(value)) return;
            setAppearanceError(false);
            void setThemeMode(value).catch(() => setAppearanceError(true));
          }}
          options={[
            { key: "system", label: translate("settingsThemeSystem") },
            { key: "light", label: translate("settingsThemeLight") },
            { key: "dark", label: translate("settingsThemeDark") }
          ]}
        />
        {appearanceError ? <UiText tone="danger">{translate("settingsAppearanceError")}</UiText> : null}
      </BottomSheet>

      <BottomSheet visible={activeSheet === "language"} onRequestClose={closeSheet} title={translate("settingsLanguageTitle")}>
        <PressableSurface
          accessibilityRole="button"
          accessibilityState={{ selected: language === "ar" }}
          onPress={() => {
            setLanguageError(false);
            void setLanguage("ar").catch(() => setLanguageError(true));
          }}
          style={[styles.languageOption, language === "ar" && { backgroundColor: theme.colors.accent }]}
        >
          <UiText weight={language === "ar" ? "700" : "500"} style={language === "ar" ? { color: theme.colors.accentForeground } : undefined}>{translate("settingsLanguageArabic")}</UiText>
          {language === "ar" ? <Icon name="circle-check" size={19} color={theme.colors.accentForeground} /> : null}
        </PressableSurface>
        <PressableSurface
          accessibilityRole="button"
          accessibilityState={{ selected: language === "en" }}
          onPress={() => {
            setLanguageError(false);
            void setLanguage("en").catch(() => setLanguageError(true));
          }}
          style={[styles.languageOption, language === "en" && { backgroundColor: theme.colors.accent }]}
        >
          <UiText weight={language === "en" ? "700" : "500"} style={language === "en" ? { color: theme.colors.accentForeground } : undefined}>{translate("settingsLanguageEnglish")}</UiText>
          {language === "en" ? <Icon name="circle-check" size={19} color={theme.colors.accentForeground} /> : null}
        </PressableSurface>
        {languageError ? <UiText tone="danger">{translate("settingsLanguageSaveError")}</UiText> : null}
      </BottomSheet>

      <ConfirmDialog
        visible={signOutConfirmOpen}
        onRequestClose={() => {
          if (!signOutMutation.isPending) setSignOutConfirmOpen(false);
        }}
        onConfirm={() => {
          setSignOutError(false);
          signOutMutation.mutate();
        }}
        title={translate("settingsSignOutConfirmTitle")}
        description={translate("settingsSignOutConfirmHint")}
        cancelLabel={translate("back")}
        confirmLabel={translate("settingsSignOutConfirmAction")}
        busy={signOutMutation.isPending}
        destructive
      />
    </CustomerScreen>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  theme,
  styles,
  last = false
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  theme: AppTheme;
  styles: ReturnType<typeof createStyles>;
  last?: boolean;
}) {
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.linkRow, last ? undefined : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}
    >
      <View style={styles.linkLabel}>
        <View style={styles.iconBadge}>
          <Icon name={icon} size={19} color={theme.colors.accentOnSurface} />
        </View>
        <UiText weight="700">{label}</UiText>
      </View>
      <View style={styles.rowTrailing}>
        <Icon name="chevron-left" size={18} color={theme.colors.subtle} />
      </View>
    </PressableSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screenContent: { gap: designTokens.spacing.md },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: designTokens.spacing.md
    },
    headerTitle: {
      flex: 1,
      textAlign: "auto"
    },
    backButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: designTokens.radius.lg,
      backgroundColor: theme.colors.surfaceSecondary
    },
    section: {
      gap: designTokens.spacing.sm,
      marginTop: 0
    },
    preferenceGrid: {
      flexDirection: "row",
      gap: designTokens.spacing.sm
    },
    preferenceCard: {
      flex: 1,
      minWidth: 0,
      minHeight: 112,
      padding: designTokens.spacing.sm,
      borderRadius: designTokens.radius.lg,
      backgroundColor: theme.colors.surfaceSecondary,
      justifyContent: "space-between",
      gap: designTokens.spacing.sm
    },
    preferenceIconBadge: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: designTokens.radius.md,
      backgroundColor: theme.colors.accent
    },
    preferenceCopy: {
      gap: designTokens.spacing.xs,
      minWidth: 0
    },
    privacyRowCopy: {
      flex: 1,
      minWidth: 0,
      gap: designTokens.spacing.xs
    },
    signOutRow: {
      minHeight: 58,
      paddingHorizontal: designTokens.spacing.md,
      paddingVertical: designTokens.spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: designTokens.radius.lg,
      backgroundColor: theme.colors.surfaceSecondary
    },
    sectionContent: {
      gap: 0,
      paddingHorizontal: designTokens.spacing.md,
      paddingVertical: designTokens.spacing.xs,
      borderRadius: designTokens.radius.xl
    },
    input: {
      height: designTokens.dimensions.controlHeight.lg,
      minHeight: designTokens.dimensions.controlHeight.lg,
      paddingVertical: 0,
      textAlign: "auto"
    },
    passwordStrength: {
      gap: designTokens.spacing.xs
    },
    countrySearch: { minHeight: designTokens.dimensions.controlHeight.md },
    accountList: {
      gap: designTokens.spacing.sm
    },
    accountOption: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: designTokens.spacing.md,
      padding: designTokens.spacing.md,
      borderRadius: designTokens.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface
    },
    accountAvatar: {
      width: 42,
      height: 42,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 21,
      backgroundColor: theme.colors.surfaceSecondary
    },
    accountOptionCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    countryOptionCopy: { flex: 1, gap: designTokens.spacing.xs },
    strengthHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: designTokens.spacing.md
    },
    strengthBars: {
      flex: 1,
      flexDirection: "row",
      gap: designTokens.spacing.xs
    },
    strengthBar: {
      flex: 1,
      height: 5,
      borderRadius: designTokens.radius.pill,
      backgroundColor: theme.colors.surfaceMuted
    },
    linkRow: {
      minHeight: 68,
      paddingVertical: designTokens.spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: designTokens.spacing.md
    },
    linkLabel: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: designTokens.spacing.md
    },
    iconBadge: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: designTokens.radius.md,
      backgroundColor: theme.colors.surfaceSecondary
    },
    rowTrailing: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: designTokens.radius.pill,
      backgroundColor: theme.colors.surfaceMuted
    },
    sheetContent: {
      gap: designTokens.spacing.md
    },
    languageOption: {
      minHeight: designTokens.dimensions.controlHeight.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: designTokens.spacing.md,
      borderRadius: designTokens.radius.md,
      backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted
    },
    signOutButton: {
      marginTop: designTokens.spacing.md,
      marginBottom: designTokens.spacing.sm
    }
  });
}

function getPasswordStrength(value: string): number {
  if (!value) return 0;
  return [
    value.length >= 8,
    /[a-z]/.test(value) && /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ].filter(Boolean).length;
}

function passwordStrengthLabel(score: number): "passwordStrengthWeak" | "passwordStrengthFair" | "passwordStrengthGood" | "passwordStrengthStrong" {
  if (score <= 1) return "passwordStrengthWeak";
  if (score === 2) return "passwordStrengthFair";
  if (score === 3) return "passwordStrengthGood";
  return "passwordStrengthStrong";
}

function getCurrencySymbol(code: string): string {
  const symbols: Record<string, string> = {
    DZD: "دج",
    AED: "د.إ",
    SAR: "ر.س",
    USD: "$",
    EUR: "€",
    GBP: "£",
    CNY: "¥"
  };
  return symbols[code] ?? code;
}
