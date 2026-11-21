import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname } from "expo-router";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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

type AssistantLink = { label: string; route: string };
type AssistantMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  links?: AssistantLink[];
};

const STATIC_ASSISTANT_ROUTES = new Set([
  "/home", "/explore", "/map", "/profile", "/settings", "/orders",
  "/merchant", "/merchant/orders", "/merchant/products", "/merchant/settings",
  "/merchant/account-settings"
]);

function parseAssistantLinks(value: string): { text: string; links: AssistantLink[] } {
  const links: AssistantLink[] = [];
  const text = value.replace(/\[([^\]]+)\]\(arownd:([^\s)]+)\)/g, (match, rawLabel: string, rawRoute: string) => {
    const label = rawLabel.trim();
    const route = rawRoute.trim();
    const validStatic = STATIC_ASSISTANT_ROUTES.has(route);
    const validOrder = /^\/orders\/[0-9a-f-]{36}$/i.test(route);
    const validMerchantProduct = /^\/merchant\/products\/[0-9a-f-]{36}$/i.test(route);
    if (!label || (!validStatic && !validOrder && !validMerchantProduct)) return label || match;
    links.push({ label, route });
    return label;
  });
  return { text, links };
}

type ArowndAideResponse = {
  error?: string;
  answer?: string;
  retryAfterSeconds?: number;
  quota?: { remaining?: number; resetAt?: string };
};

const TOUR_STORAGE_PREFIX = "arownd:ai-tour:v1:";
const TOUR_PENDING_PREFIX = "arownd:ai-tour:pending:";
const TOUR_STEPS: Record<"ar" | "en", { customer: TourStep[]; merchant: TourStep }> = {
  ar: {
    customer: [
      { title: "مرحباً بك في Arownd", description: "أنا Arownd Aide، مرشدك داخل التطبيق. سأرافقك للتعرف على الأقسام الأساسية، ويمكنك الانتقال بالضغط على التالي أو تخطي الجولة في أي وقت.", route: "/home" },
      { title: "الرئيسية", description: "هنا تكتشف المنتجات والمتاجر. يمكنك تصفح المنتجات، فتح تفاصيلها، والانتقال إلى المتجر الذي يعرضها.", route: "/home" },
      { title: "الاستكشاف", description: "استخدم البحث للوصول إلى المنتجات والمتاجر والعلامات التجارية. تظهر النتائج أثناء الكتابة ويمكنك فتح تفاصيل أي نتيجة.", route: "/explore" },
      { title: "الخريطة", description: "اكتشف المتاجر على الخريطة، اختر متجراً لعرض معلوماته، ويمكنك استكشاف المتاجر القريبة عند السماح بالوصول إلى الموقع.", route: "/map" },
      { title: "حسابي", description: "من هنا تدير بياناتك الشخصية، طلباتك، مفضلتك، تقييماتك، وعناوين التوصيل وإعدادات التطبيق.", route: "/profile" }
    ],
    merchant: { title: "Arownd Studio", description: "يمكنك من مساحة التاجر إدارة الطلبات والمنتجات والمخزون والتحليلات والفريق. تختلف الخيارات المتاحة حسب دورك وصلاحياتك في المتجر.", route: "/merchant/orders" }
  },
  en: {
    customer: [
      { title: "Welcome to Arownd", description: "I’m Arownd Aide, your in-app guide. I’ll walk you through the main sections. Press Next to continue or skip the tour at any time.", route: "/home" },
      { title: "Home", description: "Discover products and stores, browse product cards, open product details, and visit the stores offering them.", route: "/home" },
      { title: "Explore", description: "Search for products, stores, and brands. Results appear as you type, and you can open any result for more details.", route: "/explore" },
      { title: "Map", description: "Discover stores on the map, select a store to view its details, and explore nearby places when location access is allowed.", route: "/map" },
      { title: "My account", description: "Manage your personal details, orders, favorites, reviews, delivery addresses, and app settings.", route: "/profile" }
    ],
    merchant: { title: "Arownd Studio", description: "Use the merchant space to manage orders, products, inventory, analytics, and your team. Available actions depend on your store role and permissions.", route: "/merchant/orders" }
  }
};

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
  const [isSending, setIsSending] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const chatScrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const checkingRef = useRef(false);
  const tourStartedRef = useRef(false);
  const isArabic = language === "ar";
  const copy = useMemo(() => ({
    title: "Arownd Aide",
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
        setQuotaRemaining(null);
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
  const submitQuestion = async () => {
    const value = question.trim();
    if (!value || isSending) return;
    if (value.toLocaleLowerCase().includes("الجولة") || value.toLocaleLowerCase().includes("tour")) {
      setQuestion("");
      void restartTour();
      return;
    }

    const userMessage: AssistantMessage = { id: Date.now(), role: "user", text: value };
    const history = [
      ...messages.slice(-10).map((message) => ({
        role: message.role,
        content: message.text
      })),
      { role: "user" as const, content: value }
    ];
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setIsSending(true);

    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const { data, error } = await getSupabaseClient().functions.invoke("arownd-aide", {
        body: { language, messages: history, timeZone, screen: pathname }
      });

      let responseData: ArowndAideResponse | null = data as ArowndAideResponse | null;
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === "function") {
          responseData = await context.clone().json().catch(() => null) as ArowndAideResponse | null;
        }
      }

      const quota = responseData?.quota;
      if (typeof quota?.remaining === "number") {
        setQuotaRemaining(Math.max(0, Math.min(50, quota.remaining)));
      }

      if (responseData?.error === "DAILY_LIMIT_REACHED") {
        const resetAt = typeof quota?.resetAt === "string" ? new Date(quota.resetAt) : null;
        const resetTime = resetAt && !Number.isNaN(resetAt.getTime())
          ? new Intl.DateTimeFormat(isArabic ? "ar" : "en", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone
            }).format(resetAt)
          : null;
        const limitMessage = isArabic
          ? "وصلت إلى الحد اليومي البالغ 50 رسالة. تتجدد حصتك " + (resetTime ? "عند " + resetTime : "عند منتصف الليل بالتوقيت المحلي") + "."
          : "You've reached the daily limit of 50 messages. Your quota resets " + (resetTime ? "at " + resetTime : "at local midnight") + ".";
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", text: limitMessage }]);
        return;
      }

      if (responseData?.error === "RATE_LIMITED") {
        const retryAfter = Math.max(1, Number(responseData.retryAfterSeconds) || 60);
        const rateMessage = isArabic
          ? "أرسلت رسائل بسرعة كبيرة. حاول مرة أخرى بعد " + retryAfter + " ثانية."
          : "You're sending messages too quickly. Try again in " + retryAfter + " seconds.";
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", text: rateMessage }]);
        return;
      }

      if (error) throw error;
      const answer = typeof responseData?.answer === "string" && responseData.answer.trim()
        ? responseData.answer.trim()
        : (isArabic ? "لم أتمكن من إعداد إجابة الآن. حاول مرة أخرى." : "I couldn't prepare an answer right now. Please try again.");
      const parsedAnswer = parseAssistantLinks(answer);
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: "assistant",
        text: parsedAnswer.text,
        links: parsedAnswer.links
      }]);
    } catch {
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: "assistant",
        text: isArabic
          ? "تعذر الاتصال بخدمة Arownd Aide حالياً. تحقق من الاتصال وحاول مرة أخرى."
          : "Arownd Aide is temporarily unavailable. Check your connection and try again."
      }]);
    } finally {
      setIsSending(false);
    }
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
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.keyboardContainer}
          >
            <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
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
                <ScrollView
                  ref={chatScrollRef}
                  style={styles.chatScroll}
                  contentContainerStyle={styles.chatScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                >
                  <UiText weight="700" style={{ fontSize: 19 }}>{copy.title}</UiText>
                  {quotaRemaining !== null ? (
                    <UiText tone="muted" style={{ fontSize: 11 }}>
                      {isArabic ? "المتبقي اليوم: " + quotaRemaining + " من 50 رسالة" : quotaRemaining + " of 50 messages remaining today"}
                    </UiText>
                  ) : null}
                  <UiText style={styles.bodyCopy}>{copy.intro}</UiText>
                  {messages.map((message) => (
                    <View key={message.id} style={[styles.messageBubble, { backgroundColor: theme.colors.surfaceSecondary, alignSelf: message.role === "assistant" ? "flex-start" : "flex-end" }]}>
                      <UiText>
                        {message.text}
                        {message.links?.map((link, index) => (
                          <UiText
                            key={message.id + "-link-" + index}
                            accessibilityRole="link"
                            accessibilityLabel={link.label}
                            onPress={() => {
                              setChatOpen(false);
                              router.push(link.route as never);
                            }}
                            style={{ color: theme.colors.accent, textDecorationLine: "underline", fontWeight: "700" }}
                          >
                            {link.label}
                          </UiText>
                        ))}
                      </UiText>
                    </View>
                  ))}
                  {isSending ? <UiText tone="muted" style={{ fontSize: 12 }}>{isArabic ? "Arownd Aide يكتب..." : "Arownd Aide is responding..."}</UiText> : null}
                  {messages.length === 0 ? (
                    <View style={styles.suggestions}>
                      {copy.suggested.map((suggestion) => (
                        <Pressable key={suggestion} onPress={() => { setQuestion(suggestion); }} style={[styles.suggestionChip, { borderColor: theme.colors.border }]}>
                          <UiText style={{ fontSize: 12 }}>{suggestion}</UiText>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </ScrollView>
                <View style={[styles.inputRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                  <TextInput
                    editable={!isSending}
                    value={question}
                    onChangeText={setQuestion}
                    placeholder={copy.placeholder}
                    placeholderTextColor={theme.colors.placeholder}
                    onSubmitEditing={submitQuestion}
                    returnKeyType="send"
                    style={[styles.input, { color: theme.colors.foreground }]}
                    textAlign={isArabic ? "right" : "left"}
                  />
                  <Pressable disabled={isSending} accessibilityRole="button" accessibilityLabel={copy.send} onPress={submitQuestion} style={[styles.sendButton, { backgroundColor: theme.colors.accent }]}>
                    <Icon name="send" size={18} color={theme.colors.accentForeground} />
                  </Pressable>
                </View>
              </View>
            )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: { position: "absolute", width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", zIndex: 30, elevation: 8 },
  modalRoot: { flex: 1 },
  keyboardContainer: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.42)" },
  panel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 18, gap: 18, height: "78%", maxHeight: "78%" },
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
  chatContent: { flex: 1, minHeight: 0, gap: 14, paddingBottom: 8 },
  chatScroll: { flex: 1, minHeight: 0 },
  chatScrollContent: { gap: 14, paddingBottom: 8 },
  messageBubble: { maxWidth: "92%", padding: 12, borderRadius: 14, gap: 10 },
  routeButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-start" },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestionChip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 8 },
  inputRow: { minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 44, paddingVertical: 8, fontSize: 14 },
  sendButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" }
});
