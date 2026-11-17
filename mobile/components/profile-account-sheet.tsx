import { useEffect, useMemo, useState } from "react";
import { Share, ScrollView, View } from "react-native";
import * as Linking from "expo-linking";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, Caption, FormLabel, Heading, Icon, PressableSurface, SegmentedControl, StatusBadge, Text as UiText, TextField } from "@/components/ui";
import { ErrorState, LoadingState } from "@/components/customer-ui";
import { fetchCheckoutRegions } from "@/lib/checkout";
import { fetchDeliveryProfileCommunes, fetchMyDeliveryProfile, saveMyDeliveryProfile } from "@/lib/delivery-profile";
import { DeliveryProfileSchema, type DeliveryProfileInput } from "@/lib/delivery-profile-state";
import { createMyAddress, deleteMyAddress, fetchMyAddresses, setMyDefaultAddress, updateMyAddress, type UserAddress } from "@/lib/user-address";
import { UserAddressSchema, type UserAddressInput } from "@/lib/user-address-state";
import { fetchMyInviteOverview } from "@/lib/arownd-invite";
import { formatInviteCode } from "@/lib/invite-code";
import { getProfileInitial } from "@/lib/profile-state";
import { getRegionDisplayName, getRegionLevelDisplayName, normalizePhoneForCallingCode } from "@/lib/country-regions";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

export type ProfileAccountSection = "delivery" | "addresses" | "invite";

export function ProfileAccountSheet({ section, onClose }: { section: ProfileAccountSection; onClose: () => void }) {
  const title = section === "delivery" ? translate("deliveryProfileTitle") : section === "addresses" ? translate("addressesTitle") : translate("inviteTitle");
  return (
    <View style={{ maxHeight: "88%", minHeight: 220, gap: designTokens.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <PressableSurface accessibilityLabel={translate("back")} onPress={onClose} hitSlop={10}>
          <Icon name="x" size={20} />
        </PressableSurface>
        <Heading level={3}>{title}</Heading>
        <View style={{ width: 20 }} />
      </View>
      {section === "delivery" ? <DeliveryContent /> : section === "addresses" ? <AddressesContent /> : <InviteContent />}
    </View>
  );
}

function DeliveryContent() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [regionId, setRegionId] = useState<number | null>(null);
  const [secondaryRegionId, setSecondaryRegionId] = useState<number | null>(null);
  const [commune, setCommune] = useState("");
  const [picker, setPicker] = useState<"region" | "secondary" | "commune" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = useQuery({ queryKey: ["my-delivery-profile"], queryFn: fetchMyDeliveryProfile });
  const regions = useQuery({ queryKey: ["checkout-regions"], queryFn: () => fetchCheckoutRegions(), staleTime: Infinity });
  const secondary = useQuery({ queryKey: ["checkout-regions", regionId], queryFn: () => fetchCheckoutRegions(regionId), enabled: regionId !== null, staleTime: Infinity });
  const communes = useQuery({ queryKey: ["checkout-communes", regionId], queryFn: () => fetchDeliveryProfileCommunes(regionId as number), enabled: regionId !== null, staleTime: 5 * 60 * 1000 });
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!profile.isSuccess || initialized) return;
    setFullName(profile.data?.full_name ?? "");
    setPhone(profile.data?.phone ?? "");
    setRegionId(profile.data?.region_id ?? null);
    setSecondaryRegionId(profile.data?.secondary_region_id ?? null);
    setCommune(profile.data?.commune ?? "");
    setInitialized(true);
  }, [profile.data, profile.isSuccess, initialized]);
  const selectedRegion = regions.data?.regions.find((item) => item.id === regionId) ?? null;
  const selectedSecondary = secondary.data?.regions.find((item) => item.id === secondaryRegionId) ?? null;
  const mutation = useMutation({
    mutationFn: saveMyDeliveryProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-delivery-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["checkout-profile"] });
      setError(null);
    },
    onError: () => setError(translate("deliveryProfileSaveError"))
  });
  const submit = () => {
    if (!regions.data) return;
    if (fullName.trim().length < 2 || fullName.trim().length > 120) { setError(translate("deliveryProfileNameError")); return; }
    let normalizedPhone = "";
    try { normalizedPhone = normalizePhoneForCallingCode(phone, regions.data.callingCode); }
    catch { setError(translate("deliveryProfilePhoneError")); return; }
    if (regionId === null) { setError(translate("deliveryProfileRegionError")); return; }
    if (regions.data.levels[1]?.is_required && secondaryRegionId === null) { setError(translate("deliveryProfileSecondaryRegionError")); return; }
    if (commune.trim().length < 2 || commune.trim().length > 100) { setError(translate("deliveryProfileCommuneError")); return; }
    const candidate: DeliveryProfileInput = { full_name: fullName.trim(), phone: normalizedPhone, region_id: regionId, secondary_region_id: secondaryRegionId, commune: commune.trim() };
    const parsed = DeliveryProfileSchema.safeParse(candidate);
    if (!parsed.success) { setError(translate("deliveryProfileCommuneError")); return; }
    setError(null);
    mutation.mutate(parsed.data);
  };
  if (profile.isPending || regions.isPending) return <LoadingState label={translate("stateLoading")} />;
  if (profile.isError || regions.isError) return <ErrorState title={translate("deliveryProfileLoadError")} retryLabel={translate("retry")} busy={profile.isFetching || regions.isFetching} onRetry={() => { void profile.refetch(); void regions.refetch(); }} />;
  if (picker) {
    const items = picker === "region" ? regions.data.regions : picker === "secondary" ? (secondary.data?.regions ?? []) : (communes.data ?? []).map((name) => ({ id: name, name, name_ar: name }));
    const label = picker === "region" ? getRegionLevelDisplayName(regions.data.selectedLevel, language) : picker === "secondary" ? (secondary.data ? getRegionLevelDisplayName(secondary.data.selectedLevel, language) : "") : translate("checkoutChooseCommune");
    return <View style={{ flex: 1, minHeight: 240, gap: designTokens.spacing.sm }}>
      <Button label={translate("back")} variant="ghost" onPress={() => setPicker(null)} />
      <Heading level={3}>{label}</Heading>
      <ScrollView keyboardShouldPersistTaps="handled">
        {items.map((item: any) => <PressableSurface key={String(item.id)} onPress={() => {
          if (picker === "region") { setRegionId(Number(item.id)); setSecondaryRegionId(null); setCommune(""); }
          else if (picker === "secondary") setSecondaryRegionId(Number(item.id));
          else setCommune(String(item.name ?? item.id));
          setPicker(null);
        }} style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <UiText>{picker === "commune" ? String(item.name ?? item.id) : getRegionDisplayName(item, language)}</UiText>
        </PressableSurface>)}
      </ScrollView>
    </View>;
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.lg }}>
    <Caption>{translate("deliveryProfileSubtitle")}</Caption>
    <FormLabel>{translate("fullNamePlaceholder")}</FormLabel>
    <TextField value={fullName} onChangeText={setFullName} placeholder={translate("fullNamePlaceholder")} maxLength={120} />
    <FormLabel>{translate("checkoutPhonePlaceholder")}</FormLabel>
    <TextField value={phone} onChangeText={setPhone} placeholder={translate("checkoutPhonePlaceholder")} keyboardType="phone-pad" />
    <FormLabel>{getRegionLevelDisplayName(regions.data.selectedLevel, language)}</FormLabel>
    <Button label={selectedRegion ? getRegionDisplayName(selectedRegion, language) : getRegionLevelDisplayName(regions.data.selectedLevel, language)} variant="outline" onPress={() => setPicker("region")} fullWidth />
    {regions.data.levels[1] ? <>
      <FormLabel>{getRegionLevelDisplayName(regions.data.levels[1], language)}</FormLabel>
      <Button label={selectedSecondary ? getRegionDisplayName(selectedSecondary, language) : getRegionLevelDisplayName(regions.data.levels[1], language)} variant="outline" onPress={() => setPicker("secondary")} disabled={regionId === null || secondary.isPending} fullWidth />
    </> : null}
    <FormLabel>{translate("checkoutCommune")}</FormLabel>
    {(communes.data?.length ?? 0) > 0 ? <Button label={commune || translate("checkoutChooseCommune")} variant="outline" onPress={() => setPicker("commune")} fullWidth /> : <TextField value={commune} onChangeText={setCommune} placeholder={translate("checkoutCommunePlaceholder")} />}
    {error ? <UiText tone="danger">{error}</UiText> : null}
    {mutation.isSuccess ? <UiText tone="success" weight="700">{translate("deliveryProfileSaved")}</UiText> : null}
    <Button label={translate("deliveryProfileSave")} onPress={submit} loading={mutation.isPending} disabled={mutation.isPending || !initialized} fullWidth />
  </ScrollView>;
}

function AddressesContent() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<UserAddress | null | undefined>(undefined);
  const [label, setLabel] = useState<UserAddressInput["label"]>("home");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [regionId, setRegionId] = useState<number | null>(null);
  const [secondaryId, setSecondaryId] = useState<number | null>(null);
  const [commune, setCommune] = useState("");
  const [street, setStreet] = useState("");
  const [additional, setAdditional] = useState("");
  const [picker, setPicker] = useState<"region" | "secondary" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addresses = useQuery({ queryKey: ["my-addresses"], queryFn: fetchMyAddresses });
  const regions = useQuery({ queryKey: ["checkout-regions"], queryFn: () => fetchCheckoutRegions(), staleTime: Infinity });
  const secondary = useQuery({ queryKey: ["checkout-regions", regionId], queryFn: () => fetchCheckoutRegions(regionId), enabled: regionId !== null, staleTime: Infinity });
  const selectedRegion = regions.data?.regions.find((item) => item.id === regionId) ?? null;
  const selectedSecondary = secondary.data?.regions.find((item) => item.id === secondaryId) ?? null;
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["my-addresses"] }); await queryClient.invalidateQueries({ queryKey: ["checkout-profile"] }); };
  const save = useMutation({
    mutationFn: async (input: UserAddressInput) => editor ? updateMyAddress(editor.id, input) : createMyAddress(input),
    onSuccess: async () => { await refresh(); setEditor(undefined); setError(null); },
    onError: () => setError(translate("addressesSaveError"))
  });
  const makeDefault = useMutation({ mutationFn: setMyDefaultAddress, onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteMyAddress, onSuccess: async () => { await refresh(); setDeleteTarget(null); } });
  const openEditor = (address: UserAddress | null) => {
    setLabel(address?.label ?? "home"); setRecipient(address?.recipient_name ?? ""); setPhone(address?.phone ?? "");
    setRegionId(address?.region_id ?? null); setSecondaryId(address?.secondary_region_id ?? null);
    setCommune(address?.commune ?? ""); setStreet(address?.address_line ?? ""); setAdditional(address?.additional_info ?? "");
    setError(null); setPicker(null); setEditor(address);
  };
  const submit = () => {
    if (!regions.data || regionId === null || (regions.data.levels[1]?.is_required && secondaryId === null)) { setError(translate("addressesValidation")); return; }
    let normalizedPhone = "";
    try { normalizedPhone = normalizePhoneForCallingCode(phone, regions.data.callingCode); }
    catch { setError(translate("addressesValidation")); return; }
    const parsed = UserAddressSchema.safeParse({ label, recipient_name: recipient.trim(), phone: normalizedPhone, region_id: regionId, secondary_region_id: secondaryId, commune: commune.trim(), address_line: street.trim(), additional_info: additional.trim() });
    if (!parsed.success) { setError(translate("addressesValidation")); return; }
    save.mutate(parsed.data);
  };
  if (addresses.isPending || regions.isPending) return <LoadingState label={translate("stateLoading")} />;
  if (addresses.isError || regions.isError) return <ErrorState title={translate("addressesLoadError")} retryLabel={translate("retry")} busy={addresses.isFetching || regions.isFetching} onRetry={() => { void addresses.refetch(); void regions.refetch(); }} />;
  if (deleteTarget) return <View style={{ gap: designTokens.spacing.md }}>
    <Heading level={3}>{translate("addressesDeleteTitle")}</Heading>
    <Caption>{translate("addressesDeleteHint")}</Caption>
    <Button label={translate("addressesDelete")} variant="danger" loading={remove.isPending} onPress={() => remove.mutate(deleteTarget.id)} fullWidth />
    <Button label={translate("back")} variant="outline" onPress={() => setDeleteTarget(null)} fullWidth disabled={remove.isPending} />
  </View>;
  if (picker) {
    const options = picker === "region" ? regions.data.regions : (secondary.data?.regions ?? []);
    const title = picker === "region" ? getRegionLevelDisplayName(regions.data.selectedLevel, language) : (secondary.data ? getRegionLevelDisplayName(secondary.data.selectedLevel, language) : "");
    return <View style={{ minHeight: 240, gap: designTokens.spacing.sm }}>
      <Button label={translate("back")} variant="ghost" onPress={() => setPicker(null)} />
      <Heading level={3}>{title}</Heading>
      <ScrollView>{options.map((item) => <PressableSurface key={item.id} onPress={() => {
        if (picker === "region") { setRegionId(item.id); setSecondaryId(null); setCommune(""); } else setSecondaryId(item.id);
        setPicker(null);
      }} style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}><UiText>{getRegionDisplayName(item, language)}</UiText></PressableSurface>)}</ScrollView>
    </View>;
  }
  if (editor !== undefined) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.lg }}>
    <Button label={translate("back")} variant="ghost" onPress={() => setEditor(undefined)} disabled={save.isPending} />
    <Heading level={3}>{translate(editor ? "addressesEditTitle" : "addressesAddTitle")}</Heading>
    <FormLabel>{translate("addressesType")}</FormLabel>
    <SegmentedControl value={label} onChange={(value) => { if (value === "home" || value === "work" || value === "other") setLabel(value); }} options={[{ key: "home", label: translate("addressesHome") }, { key: "work", label: translate("addressesWork") }, { key: "other", label: translate("addressesOther") }]} />
    <FormLabel>{translate("addressesRecipient")}</FormLabel><TextField value={recipient} onChangeText={setRecipient} />
    <FormLabel>{translate("addressesPhone")}</FormLabel><TextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
    <FormLabel>{getRegionLevelDisplayName(regions.data.selectedLevel, language)}</FormLabel>
    <Button label={selectedRegion ? getRegionDisplayName(selectedRegion, language) : translate("addressesType")} variant="outline" onPress={() => setPicker("region")} fullWidth />
    {regions.data.levels[1] ? <><FormLabel>{getRegionLevelDisplayName(regions.data.levels[1], language)}</FormLabel><Button label={selectedSecondary ? getRegionDisplayName(selectedSecondary, language) : getRegionLevelDisplayName(regions.data.levels[1], language)} variant="outline" onPress={() => setPicker("secondary")} disabled={regionId === null || secondary.isPending} fullWidth /></> : null}
    <FormLabel>{translate("checkoutCommune")}</FormLabel><TextField value={commune} onChangeText={setCommune} />
    <FormLabel>{translate("addressesStreet")}</FormLabel><TextField value={street} onChangeText={setStreet} />
    <FormLabel>{translate("addressesAdditional")}</FormLabel><TextField value={additional} onChangeText={setAdditional} />
    {error ? <UiText tone="danger">{error}</UiText> : null}
    <Button label={translate("deliveryProfileSave")} onPress={submit} loading={save.isPending} fullWidth />
  </ScrollView>;
  return <ScrollView contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.lg }}>
    <Caption>{translate("addressesSubtitle")}</Caption>
    <Button label={translate("addressesAdd")} onPress={() => openEditor(null)} startIcon={<Icon name="plus" size={18} />} fullWidth />
    {addresses.data.length === 0 ? <Card contentStyle={{ padding: designTokens.spacing.lg, alignItems: "center" }}><Icon name="map-pin" size={28} /><Heading level={3}>{translate("addressesEmpty")}</Heading><Caption>{translate("addressesEmptyHint")}</Caption></Card> : addresses.data.map((address) => <Card key={address.id} contentStyle={{ padding: designTokens.spacing.md, gap: designTokens.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <UiText weight="700">{translate(address.label === "home" ? "addressesHome" : address.label === "work" ? "addressesWork" : "addressesOther")}</UiText>
        {address.is_default ? <StatusBadge label={translate("addressesDefault")} tone="accent" /> : null}
      </View>
      <Heading level={3}>{address.recipient_name}</Heading><Caption>{address.phone}</Caption>
      <Caption>{address.region ? getRegionDisplayName(address.region, language) : ""}{address.secondary_region ? "، " + getRegionDisplayName(address.secondary_region, language) : ""}، {address.commune}</Caption>
      <Caption>{address.address_line}{address.additional_info ? " · " + address.additional_info : ""}</Caption>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.sm }}>
        {!address.is_default ? <Button label={translate("addressesMakeDefault")} size="sm" variant="outline" onPress={() => makeDefault.mutate(address.id)} disabled={makeDefault.isPending} /> : null}
        <Button label={translate("addressesEdit")} size="sm" variant="outline" onPress={() => openEditor(address)} />
        <Button label={translate("addressesDelete")} size="sm" variant="danger" onPress={() => setDeleteTarget(address)} />
      </View>
    </Card>)}
    {makeDefault.isError || remove.isError ? <UiText tone="danger">{makeDefault.isError ? translate("addressesDefaultError") : translate("addressesDeleteError")}</UiText> : null}
  </ScrollView>;
}

function InviteContent() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const invite = useQuery({ queryKey: ["my-invite-overview"], queryFn: fetchMyInviteOverview, retry: false });
  const link = useMemo(() => invite.data ? Linking.createURL(`invite/${invite.data.code}`, { scheme: "com.arownd.app" }) : "", [invite.data]);
  const share = async (message: string) => { try { await Share.share({ message }); } catch { /* Native share may be unavailable. */ } };
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(language === "ar" ? "ar-DZ" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  if (invite.isPending) return <LoadingState label={translate("stateLoading")} />;
  if (invite.isError || !invite.data) return <ErrorState title={translate("inviteLoadError")} retryLabel={translate("retry")} busy={invite.isFetching} onRetry={() => { void invite.refetch(); }} />;
  return <ScrollView contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.lg }}>
    <Card contentStyle={{ padding: designTokens.spacing.lg, gap: designTokens.spacing.xs }}>
      <Caption>{translate("inviteSuccessfulCount")}</Caption>
      <Heading level={1}>{String(invite.data.total)}</Heading>
    </Card>
    <Card contentStyle={{ padding: designTokens.spacing.lg, gap: designTokens.spacing.md }}>
      <Caption>{translate("inviteCodeLabel")}</Caption>
      <UiText weight="800" style={{ fontSize: 24, letterSpacing: 1.2, textAlign: "left", writingDirection: "ltr" }}>{formatInviteCode(invite.data.code)}</UiText>
      <Button label={translate("inviteShareCode")} variant="outline" fullWidth onPress={() => { void share(`${translate("inviteShareCodeMessage")}\n${formatInviteCode(invite.data.code)}\n${link}`); }} />
    </Card>
    <Card contentStyle={{ padding: designTokens.spacing.md, gap: designTokens.spacing.sm }}>
      <Caption>{translate("inviteLinkLabel")}</Caption>
      <UiText style={{ writingDirection: "ltr", textAlign: "left" }}>{link}</UiText>
      <Button label={translate("inviteShare")} fullWidth onPress={() => { void share(`${translate("inviteShareMessage")}\n${link}`); }} />
    </Card>
    <Heading level={3}>{translate("inviteHistoryTitle")} · {invite.data.total}</Heading>
    {invite.data.referrals.length === 0 ? <Caption>{translate("inviteEmptyHint")}</Caption> : invite.data.referrals.map((item) => {
      const name = item.displayName ?? translate("invitePrivateMember");
      return <View key={item.id} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, borderBottomWidth: 1, borderBottomColor: "rgba(128,128,128,0.2)" }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(128,128,128,0.12)" }}><UiText weight="700">{getProfileInitial(name)}</UiText></View>
        <View style={{ flex: 1 }}><UiText weight="600">{name}</UiText><Caption>{formatDate(item.createdAt)}</Caption></View>
        <Icon name="circle-check" size={18} color={theme.colors.success} />
      </View>;
    })}
  </ScrollView>;
}
