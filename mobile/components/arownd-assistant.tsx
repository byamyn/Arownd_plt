import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/ui";
import { Text as UiText } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import { getSupabaseClient } from "@/lib/supabase";
import { useAppTheme } from "@/lib/theme";
import { useLanguage } from "@/lib/i18n";

type TourStep = {
  title: string;
  description: string;
  route: string;
};

type AssistantMessage = {
  id: number;
  text: string;
  route?: string;
  routeLabel?: string;
};

const TOUR_STORAGE_PREFIX = "arownd:ai-tour:v1:";
const TOUR_PENDING_PREFIX = "arownd:ai-tour:pending:";
const TOUR_STEPS: Record<"ar" | "en", { customer: TourStep[]; merchant: TourStep }> = {
  ar: {
    customer: [
      { title: "مرحباً بك في Arownd", description: "أنا Arownd AI، مرشدك داخل التطبيق. سأرافقك للتعرف على الأقسام الأساسية، ويمكنك الانتقال بالضغط على التالي أو تخطي الجولة في أي وقت.", route: "/home" },
      { title: "الرئيسية", description: "هنا تكتشف المنتجات والمتاجر. يمكنك تصفح المنتجات، فتح تفاصيلها، والانتقال إلى المتجر الذي يعرضها.", route: "/home" },
      { title: "الاستكشاف", description: "استخدم البحث للوصول إلى المنتجات والمتاجر والعلامات التجارية. تظهر النتائج أثناء الكتابة ويمكنك فتح تفاصيل أي نتيجة.", route: "/explore" },
      { title: "الخريطة", description: "اكتشف المتاجر على الخريطة، اختر متجراً لعرض معلوماته، ويمكنك استكشاف المتاجر القريبة عند السماح بالوصول إلى الموقع.", route: "/map" },
      { title: "حسابي", description: "من هنا تدير بياناتك الشخصية، طلباتك، مفضلتك، تقييماتك، وعناوين التوصيل وإعدادات التطبيق.", route: "/profile" }
    ],
    merchant: { title: "Arownd Studio", description: "يمكنك من مساحة التاجر إدارة الطلبات والمنتجات والمخزون والتحليلات والفريق. تختلف الخيارات المتاحة حسب دورك وصلاحياتك في المتجر.", route: "/merchant/orders" }
  },
  en: {
    customer: [
      { title: "Welcome to Arownd", description: "I’m Arownd AI, your in-app guide. I’ll walk you through the main sections. Press Next to continue or skip the tour at any time.", route: "/home" },
      { title: "Home", description: "Discover products and stores, browse product cards, open product details, and visit the stores offering them.", route: "/home" },
      { title: "Explore", description: "Search for products, stores, and brands. Results appear as you type, and you can open any result for more details.", route: "/explore" },
      { title: "Map", description: "Discover stores on the map, select a store to view its details, and explore nearby places when location access is allowed.", route: "/map" },
      { title: "My account", description: "Manage your personal details, orders, favorites, reviews, delivery addresses, and app settings.", route: "/profile" }
    ],
    merchant: { title: "Arownd Studio", description: "Use the merchant space to manage orders, products, inventory, analytics, and your team. Available actions depend on your store role and permissions.", route: "/merchant/orders" }
  }
};

function getQuickAnswer(question: string, language: "ar" | "en"): AssistantMessage {
  const value = question.trim().toLocaleLowerCase();
  const routes: Array<{ terms: string[]; ar: AssistantMessage; en: AssistantMessage }> = [
    { terms: ["إضافة منتج", "أضيف منتج", "منتجاتي", "add product", "my products", "متجري", "تاجر", "studio", "merchant"], ar: { id: 0, text: "لإدارة متجرك، افتح Arownd Studio. ستظهر لك الصفحات والإجراءات التي تسمح بها صلاحيات عضويتك.", route: "/merchant", routeLabel: "فتح Arownd Studio" }, en: { id: 0, text: "To manage your store, open Arownd Studio. The pages and actions shown there depend on your membership permissions.", route: "/merchant", routeLabel: "Open Arownd Studio" } },
    { terms: ["بحث", "استكشاف", "منتج", "متجر", "brand", "search", "explore", "product", "store"], ar: { id: 0, text: "للبحث عن المنتجات والمتاجر والعلامات التجارية، افتح صفحة الاستكشاف واكتب ما تبحث عنه.", route: "/explore", routeLabel: "فتح الاستكشاف" }, en: { id: 0, text: "To search products, stores, and brands, open Explore and enter what you are looking for.", route: "/explore", routeLabel: "Open Explore" } },
    { terms: ["خريطة", "موقع", "قريب", "map", "location", "nearby"], ar: { id: 0, text: "يمكنك اكتشاف المتاجر جغرافياً من صفحة الخريطة.", route: "/map", routeLabel: "فتح الخريطة" }, en: { id: 0, text: "Discover stores by location from the Map screen.", route: "/map", routeLabel: "Open Map" } },
    { terms: ["طلب", "طلبات", "تتبع", "order", "track"], ar: { id: 0, text: "يمكنك مراجعة طلباتك من صفحة حسابي، ضمن قسم الطلبات.", route: "/profile", routeLabel: "فتح حسابي" }, en: { id: 0, text: "You can review your orders from My Account, in the Orders section.", route: "/profile", routeLabel: "Open My Account" } },
    { terms: ["حساب", "إعدادات", "كلمة المرور", "account", "settings", "password"], ar: { id: 0, text: "تجد إدارة الحساب وإعدادات التطبيق في صفحة حسابي، ثم الإعدادات.", route: "/settings", routeLabel: "فتح الإعدادات" }, en: { id: 0, text: "Account management and app preferences are available from My Account, then Settings.", route: "/settings", routeLabel: "Open Settings" } },
    { terms: ["متجري", "تاجر", "منتجاتي", "studio", "merchant", "my store"], ar: { id: 0, text: "تتوفر مساحة Arownd Studio للحسابات وأعضاء الفرق الذين لديهم وصول إلى متجر. افتح مساحة التاجر لعرض الخيارات المتاحة لك.", route: "/merchant", routeLabel: "فتح Arownd Studio" }, en: { id: 0, text: "Arownd Studio is available to accounts and team members with store access. Open the merchant space to see the actions available to you.", route: "/merchant", routeLabel: "Open Arownd Studio" } }
  ];
  const match = routes.find((item) => item.terms.some((term) => value.includes(term)));
  if (match) return language === "ar" ? match.ar : match.en;
  return {
    id: 0,
    text: language === "ar"
      ? "لم أجد بعد إجابة موثوقة لهذا السؤال في دليل الإرشاد الأساسي. يمكنك السؤال عن البحث أو الخريطة أو الطلبات أو إعدادات الحساب. ستُربط الإجابات الذكية الشاملة بقاعدة معرفة Arownd في مرحلة ربط خدمة الذكاء الاصطناعي."
      : "I don’t have a verified answer for that in the basic guide yet. You can ask about search, the map, orders, or account settings. Full AI answers will be connected to the Arownd knowledge base in the AI service integration phase."
  };
}

export function ArowndAssistant() {
  const theme = useAppTheme();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [merchantTour, setMerchantTour] = useState(false);
  const [tourStep, setTourStep] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const checkingRef = useRef(false);
  const tourStartedRef = useRef(false);
  const isArabic = language === "ar";
  const copy = useMemo(() => ({
    title: "Arownd AI",
    close: isArabic ? "إغلاق" : "Close",
    next: isArabic ? "التالي" : "Next",
    previous: isArabic ? "السابق" : "Previous",
    skip: isArabic ? "تخطي الجولة" : "Skip tour",
    finish: isArabic ? "إنهاء الجولة" : "Finish tour",
    progress: isArabic ? "الخطوة" : "Step",
    of: isArabic ? "من" : "of",
    welcome: isArabic ? "مرشدك داخل Arownd" : "Your guide inside Arownd",
    placeholder: isArabic ? "اكتب سؤالك عن Arownd..." : "Ask a question about Arownd...",
    send: isArabic ? "إرسال" : "Send",
    intro: isArabic ? "يمكنني مساعدتك في فهم أقسام التطبيق والوصول إلى الصفحات المناسبة. ما الذي تريد معرفته؟" : "I can help you understand the app and find the right pages. What would you like to know?",
    suggested: isArabic ? ["كيف أبحث عن منتج؟", "أين أجد طلباتي؟", "كيف أكتشف المتاجر؟", "إعادة الجولة التعريفية"] : ["How do I search for a product?", "Where can I find my orders?", "How do I discover stores?", "Restart the introduction tour"]
  }), [isArabic]);
  const steps = useMemo(() => {
    const localized = TOUR_STEPS[language];
    return merchantTour ? [...localized.customer, localized.merchant] : localized.customer;
  }, [language, merchantTour]);
  const activeStep = tourStep >= 0 ? steps[tourStep] : null;

  useEffect(() => {
    let mounted = true;
    const tryStartTour = async (id: string) => {
      if (checkingRef.current || tourStartedRef.current) return;
      checkingRef.current = true;
      try {
        const key = TOUR_STORAGE_PREFIX + id;
        const [completed, pending] = await Promise.all([
          AsyncStorage.getItem(key),
          AsyncStorage.getItem(TOUR_PENDING_PREFIX + id)
        ]);
        if (!mounted || completed || pending !== "1") return;
        const access = await fetchMerchantAccess().catch(() => null);
        if (!mounted) return;
        if (!access || access.status === "merchant_setup_required") return;
        const hasMerchantSpace = access?.status === "merchant_ready";
        setMerchantTour(hasMerchantSpace);
        tourStartedRef.current = true;
        setTourStep(0);
        if (pathname !== "/home") router.replace("/home");
      } finally {
        checkingRef.current = false;
      }
    };

    const client = getSupabaseClient();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        tourStartedRef.current = false;
        setUserId(null);
        setTourStep(-1);
        setChatOpen(false);
        return;
      }
      if ((event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        setUserId(session.user.id);
        void tryStartTour(session.user.id);
      }
    });
    void client.auth.getSession().then(({ data: sessionData }) => {
      if (!mounted || !sessionData.session?.user) return;
      setUserId(sessionData.session.user.id);
      void tryStartTour(sessionData.session.user.id);
    }).catch(() => undefined);

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [pathname]);

  useEffect(() => {
    if (!userId || tourStep >= 0 || pathname !== "/merchant") return;
    void fetchMerchantAccess().then((access) => {
      if (access?.status === "merchant_ready") {
        const key = TOUR_STORAGE_PREFIX + userId;
        void Promise.all([
          AsyncStorage.getItem(key),
          AsyncStorage.getItem(TOUR_PENDING_PREFIX + userId)
        ]).then(([completed, pending]) => {
          if (!completed && pending === "1" && !tourStartedRef.current) {
            tourStartedRef.current = true;
            setMerchantTour(true);
            setTourStep(0);
          }
        });
      }
    }).catch(() => undefined);
  }, [pathname, tourStep, userId]);

  const completeTour = () => {
    if (userId) {
      void AsyncStorage.setItem(TOUR_STORAGE_PREFIX + userId, "completed");
      void AsyncStorage.removeItem(TOUR_PENDING_PREFIX + userId);
    }
    setTourStep(-1);
  };
  const goToStep = (index: number) => {
    const step = steps[index];
    if (!step) return;
    setTourStep(index);
    if (pathname !== step.route) router.replace(step.route as never);
  };
  const restartTour = async () => {
    const access = await fetchMerchantAccess().catch(() => null);
    setMerchantTour(access?.status === "merchant_ready");
    setChatOpen(false);
    setTourStep(0);
    router.replace("/home");
  };
  const submitQuestion = () => {
    const value = question.trim();
    if (!value) return;
    if (value.toLocaleLowerCase().includes("الجولة") || value.toLocaleLowerCase().includes("tour")) {
      setQuestion("");
      void restartTour();
      return;
    }
    const answer = getQuickAnswer(value, language);
    setMessages((current) => [...current, { id: Date.now(), text: value }, { ...answer, id: Date.now() + 1 }]);
    setQuestion("");
  };
  const openChat = () => {
    setTourStep(-1);
    setChatOpen(true);
  };
  const closeModal = () => {
    if (tourStep >= 0) completeTour();
    setChatOpen(false);
  };

  if (!userId) return null;

  return (
    <>
      {tourStep < 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.title}
          onPress={openChat}
          style={[styles.floatingButton, { bottom: Math.max(insets.bottom, 12) + 72, backgroundColor: theme.colors.accent, end: 18 }]}
        >
          <Icon name="message-circle" size={25} color={theme.colors.accentForeground} />
        </Pressable>
      ) : null}
      <Modal
        visible={tourStep >= 0 || chatOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={closeModal}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.scrim} onPress={closeModal} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.panelHeader}>
              <View style={[styles.assistantMark, { backgroundColor: theme.colors.accent }]}>
                <Icon name="message-circle" size={21} color={theme.colors.accentForeground} />
              </View>
              <View style={styles.headerCopy}>
                <UiText weight="700">{copy.title}</UiText>
                <UiText tone="muted" style={{ fontSize: 12 }}>{copy.welcome}</UiText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.close} onPress={closeModal} hitSlop={10} style={styles.closeButton}>
                <Icon name="x" size={20} color={theme.colors.foreground} />
              </Pressable>
            </View>
            {activeStep ? (
              <View style={styles.tourContent}>
                <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceSecondary }]}>
                  <View style={[styles.progressValue, { backgroundColor: theme.colors.accent, width: `${((tourStep + 1) / steps.length) * 100}%` }]} />
                </View>
                <UiText tone="muted" style={{ fontSize: 12 }}>{copy.progress} {tourStep + 1} {copy.of} {steps.length}</UiText>
                <UiText weight="700" style={{ fontSize: 19 }}>{activeStep.title}</UiText>
                <UiText style={styles.bodyCopy}>{activeStep.description}</UiText>
                <View style={styles.tourActions}>
                  <Pressable onPress={completeTour} style={styles.skipButton}>
                    <UiText tone="muted" weight="600">{copy.skip}</UiText>
                  </Pressable>
                  {tourStep > 0 ? (
                    <Pressable onPress={() => goToStep(tourStep - 1)} style={[styles.secondaryButton, { borderColor: theme.colors.border }]}>
                      <UiText weight="600">{copy.previous}</UiText>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => tourStep === steps.length - 1 ? completeTour() : goToStep(tourStep + 1)} style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]}>
                    <UiText weight="700" style={{ color: theme.colors.accentForeground }}>{tourStep === steps.length - 1 ? copy.finish : copy.next}</UiText>
                    <Icon name="arrow-right" size={17} color={theme.colors.accentForeground} />
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.chatContent}>
                <UiText weight="700" style={{ fontSize: 19 }}>{copy.title}</UiText>
                <UiText style={styles.bodyCopy}>{copy.intro}</UiText>
                {messages.map((message) => (
                  <View key={message.id} style={[styles.messageBubble, { backgroundColor: theme.colors.surfaceSecondary, alignSelf: message.route ? "flex-start" : "flex-end" }]}>
                    <UiText>{message.text}</UiText>
                    {message.route && message.routeLabel ? (
                      <Pressable onPress={() => { setChatOpen(false); router.push(message.route as never); }} style={[styles.routeButton, { backgroundColor: theme.colors.accent }]}>
                        <UiText weight="700" style={{ color: theme.colors.accentForeground }}>{message.routeLabel}</UiText>
                        <Icon name="arrow-right" size={15} color={theme.colors.accentForeground} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <View style={styles.suggestions}>
                  {copy.suggested.map((suggestion) => (
                    <Pressable key={suggestion} onPress={() => { setQuestion(suggestion); }} style={[styles.suggestionChip, { borderColor: theme.colors.border }]}>
                      <UiText style={{ fontSize: 12 }}>{suggestion}</UiText>
                    </Pressable>
                  ))}
                </View>
                <View style={[styles.inputRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                  <TextInput
                    value={question}
                    onChangeText={setQuestion}
                    placeholder={copy.placeholder}
                    placeholderTextColor={theme.colors.placeholder}
                    onSubmitEditing={submitQuestion}
                    returnKeyType="send"
                    style={[styles.input, { color: theme.colors.foreground }]}
                    textAlign="auto"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={copy.send} onPress={submitQuestion} style={[styles.sendButton, { backgroundColor: theme.colors.accent }]}>
                    <Icon name="send" size={18} color={theme.colors.accentForeground} />
                  </Pressable>
                </View>
              </View>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: { position: "absolute", width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", zIndex: 30, elevation: 8 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
  panel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 18, gap: 18, maxHeight: "78%" },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  assistantMark: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 2 },
  closeButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  tourContent: { gap: 12, paddingBottom: 8 },
  progressTrack: { height: 5, borderRadius: 5, overflow: "hidden" },
  progressValue: { height: 5, borderRadius: 5 },
  bodyCopy: { lineHeight: 23, textAlign: "auto" },
  tourActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", paddingTop: 8 },
  skipButton: { paddingVertical: 12, paddingHorizontal: 4 },
  secondaryButton: { minHeight: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primaryButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  chatContent: { gap: 14, paddingBottom: 8 },
  messageBubble: { maxWidth: "92%", padding: 12, borderRadius: 14, gap: 10 },
  routeButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-start" },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestionChip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 8 },
  inputRow: { minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 44, paddingVertical: 8, fontSize: 14 },
  sendButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" }
});
