import { zodResolver } from "@hookform/resolvers/zod";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import {
  ActionButton,
  AuthField,
  AuthLayout,
  AuthCountrySelector,
  AuthStepIndicator,
  PasswordStrengthMeter,
  FormError,
  InlineLink,
  SuccessPanel
} from "@/components/auth-ui";
import { signUpPersonal } from "@/lib/auth-service";
import { personalSignupSchema, type PersonalSignupInput } from "@/lib/auth-validation";
import { translate, useLanguage } from "@/lib/i18n";
import { Text as UiText } from "@/components/ui";
import { designTokens } from "@/lib/theme";
import { fetchCountries, getSelectedCountryCode, type Country } from "@/lib/country-service";

export default function PersonalSignupScreen() {
  const { language } = useLanguage();
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [accountCountry, setAccountCountry] = useState<Country | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    void Promise.all([getSelectedCountryCode(), fetchCountries()]).then(([code, countries]) => {
      if (active) setAccountCountry(countries.find((country) => country.code === code && country.is_enabled) ?? null);
    }).catch(() => {
      if (active) setAccountCountry(null);
    });
    return () => { active = false; };
  }, []));

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<PersonalSignupInput>({
    resolver: zodResolver(personalSignupSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: ""
    }
  });

  const submit = handleSubmit(async (values) => {
    setServerError(null);

    try {
      const sessionCreated = await signUpPersonal(values);
      setHasSession(sessionCreated);
      setCreated(true);
    } catch (error) {
      setServerError(
        error instanceof Error && error.message === "SUPABASE_CONFIG_MISSING"
          ? translate("configError")
          : error instanceof Error && error.message === "COUNTRY_NOT_SELECTED"
            ? translate("countryRequired")
            : error instanceof Error && error.message === "USERNAME_TAKEN"
              ? translate("usernameTaken")
              : error instanceof Error && error.message === "USERNAME_RESERVED"
                ? translate("usernameReserved")
                : translate("genericError")
      );
    }
  });

  return (
    <AuthLayout
      title={translate("personalSignupTitle")}
      subtitle={translate("personalSignupSubtitle")}
      showBack
    >
      {created ? (
        <View style={styles.form}>
          <SuccessPanel
            title={translate(hasSession ? "accountCreatedTitle" : "signupSuccessTitle")}
            message={translate(hasSession ? "accountCreatedMessage" : "signupSuccess")}
          />
          <ActionButton
            label={translate("backToLogin")}
            onPress={() => router.replace("/login")}
          />
        </View>
      ) : (
        <View style={styles.form}>
          <AuthStepIndicator currentStep={2} />
          <AuthCountrySelector
            label={translate("signupAccountCountry")}
            value={accountCountry ? accountCountry.flag_emoji + " " + (language === "ar" ? accountCountry.name_ar : accountCountry.name_en ?? accountCountry.name_ar) : translate("countryRequired")}
            onPress={() => router.push({ pathname: "/country-selection", params: { returnTo: "signup-personal" } })}
          />
          <Controller
            control={control}
            name="username"
            render={({ field: { onChange, onBlur, value } }) => (
              <AuthField
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textAlign="left"
                label={translate("username")}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={translate("usernamePlaceholder")}
                icon="user"
                error={errors.username ? translate(errors.username.message as "required" | "usernameInvalid" | "usernameReserved") : undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <AuthField
                label={translate("email")}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                keyboardType="email-address"
                autoComplete="email"
                icon="mail"
                placeholder={translate("emailPlaceholder")}
                error={
                  errors.email
                    ? translate(errors.email.message as "required" | "invalidEmail")
                    : undefined
                }
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <AuthField
                label={translate("password")}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry
                icon="lock"
                autoComplete="new-password"
                placeholder={translate("passwordPlaceholder")}
                error={errors.password ? translate("passwordMin") : undefined}
              />
            )}
          />
          <PasswordStrengthMeter password={watch("password")} />

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <AuthField
                label={translate("confirmPassword")}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry
                icon="lock"
                placeholder={translate("confirmPasswordPlaceholder")}
                error={
                  errors.confirmPassword
                    ? translate(errors.confirmPassword.message as "required" | "passwordMismatch")
                    : undefined
                }
              />
            )}
          />

          {serverError ? <FormError message={serverError} /> : null}

          <ActionButton
            label={isSubmitting ? translate("signupBusy") : translate("signup")}
            onPress={() => void submit()}
            loading={isSubmitting}
          />

          <View style={styles.loginRow}>
            <UiText tone="muted" style={styles.secondaryText}>
              {translate("alreadyHaveAccount")}
            </UiText>
            <InlineLink
              label={translate("login")}
              onPress={() => router.push("/login")}
            />
          </View>
        </View>
      )}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: designTokens.spacing.lg
  },
  loginRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: designTokens.spacing.xs,
    marginTop: designTokens.spacing.xs
  },
  secondaryText: {
    fontSize: designTokens.typography.body - 1
  }
});
