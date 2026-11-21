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
type AssistantPart = { text: string; link?: AssistantLink };
type AssistantMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  parts?: AssistantPart[];
};

const STATIC_ASSISTANT_ROUTES = new Set([
  "/home", "/explore", "/map", "/profile", "/settings", "/orders",
  "/merchant", "/merchant/orders", "/merchant/products", "/merchant/settings",
  "/merchant/account-settings"
]);

function parseAssistantLinks(value: string): { text: string; parts: AssistantPart[] } {
  const parts: AssistantPart[] = [];
  const expression = /\[([^\]]+)\]\(arownd:([^\s)]+)\)/g;
  let cursor = 0;
  let plainText = "";
  for (const match of value.matchAll(expression)) {
    const fullMatch = match[0];
    const label = (match[1] ?? "").trim();
    const route = (match[2] ?? "").trim();
    const index = match.index ?? cursor;
    const validStatic = STATIC_ASSISTANT_ROUTES.has(route);
    const validOrder = /^\/orders\/[0-9a-f-]{36}$/i.test(route);
    const validMerchantOrder = /^\/merchant\/orders\/[0-9a-f-]{36}$/i.test(route);
    const validMerchantProduct = /^\/merchant\/products\/[0-9a-f-]{36}$/i.test(route);
    if (index > cursor) {
      const preceding = value.slice(cursor, index);
      parts.push({ text: preceding });
      plainText += preceding;
    }
    if (label && (validStatic || validOrder || validMerchantOrder || validMerchantProduct)) {
      const link = { label, route };
      parts.push({ text: label, link });
      plainText += label;
    } else {
      parts.push({ text: label || fullMatch });
      plainText += label || fullMatch;
    }
    cursor = index + fullMatch.length;
  }
  if (cursor < value.length) {
    const trailing = value.slice(cursor);
    parts.push({ text: trailing });
    plainText += trailing;
  }
  if (parts.length === 0) parts.push({ text: value });
  return { text: plainText, parts };
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
  const [assistantAudience, setAssistantAudience] = useState<"personal" | "business">("personal");
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
    newChat: isArabic ? "محادثة جديدة" : "New chat",
    next: isArabic ? "التالي" : "Next",
    previous: isArabic ? "السابق" : "Previous",
    skip: isArabic ? "تخطي الجولة" : "Skip tour",
    finish: isArabic ? "إنهاء الجولة" : "Finish tour",
    progress: isArabic ? "الخطوة" : "Step",
    of: isArabic ? "من" : "of",
    welcome: isArabic ? "مساعدك للتعلّم واستخدام Arownd" : "Your guide to learning and using Arownd",
    greeting: isArabic ? "كيف يمكنني مساعدتك اليوم؟" : "How can I help you today?",
    subtitle: isArabic ? "اسألني عمّا تريد فهمه، وسأرشدك خطوة بخطوة." : "Ask me anything you want to understand, and I’ll guide you step by step.",
    suggestedTitle: isArabic ? "يمكنك البدء بسؤال مثل" : "You could start with",
    placeholder: isArabic ? "اسأل Arownd Aide..." : "Ask Arownd Aide...",
    send: isArabic ? "إرسال" : "Send",
    suggested: assistantAudience === "business"
      ? (isArabic
        ? ["كيف أبدأ بإدارة متجري؟", "كيف أضيف منتجاً؟", "كيف أتعامل مع طلب جديد؟", "كيف أحسن عرض منتجاتي؟"]
        : ["How do I manage my store?", "How do I add a product?", "How should I handle a new order?", "How can I improve my product listings?"])
      : (isArabic
        ? ["كيف أبحث عن منتج؟", "كيف أتابع طلبي؟", "كيف أكتشف المتاجر؟", "كيف أستخدم المفضلة؟"]
        : ["How do I find a product?", "How do I track my order?", "How do I discover stores?", "How do I use favorites?"])
  }), [isArabic, assistantAudience]);
  const steps = useMemo(() => {
    const localized = TOUR_STEPS[language];
    return merchantTour ? [...localized.customer, localized.merchant] : localized.customer;
  }, [language, merchantTour]);
  const activeStep = tourStep >= 0 ? steps[tourStep] : null;

  useEffect(() => {
    if (!userId) {
      setAssistantAudience("personal");
      return;
    }
    let active = true;
    void fetchMerchantAccess().then((access) => {
      if (!active) return;
      setAssistantAudience(access?.status === "merchant_ready" || access?.status === "merchant_setup_required" ? "business" : "personal");
    }).catch(() => {
      if (active) setAssistantAudience("personal");
    });
    return () => {
      active = false;
    };
  }, [userId]);

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
  const submitQuestion = async (suggestedQuestion?: string) => {
    const value = (suggestedQuestion ?? question).trim();
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
        parts: parsedAnswer.parts
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
            <View style={[activeStep ? styles.tourPanel : styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, paddingTop: activeStep ? 18 : Math.max(insets.top, 12) + 10, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.panelHeader}>
              <View style={[styles.assistantMark, { backgroundColor: theme.colors.accent }]}>
                <Icon name="message-circle" size={21} color={theme.colors.accentForeground} />
              </View>
              <View style={styles.headerCopy}>
                <UiText weight="700">{copy.title}</UiText>
                <UiText tone="muted" style={{ fontSize: 12 }}>{copy.welcome}</UiText>
              </View>
              {!activeStep ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.newChat}
                  onPress={() => { setMessages([]); setQuestion(""); }}
                  hitSlop={10}
                  style={styles.headerAction}
                >
                  <Icon name="plus" size={20} color={theme.colors.foreground} />
                </Pressable>
              ) : null}
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
                  {messages.length === 0 ? (
                    <View style={styles.emptyState}>
                      <View style={[styles.emptyMark, { backgroundColor: theme.colors.surfaceSecondary }]}>
                        <Icon name="message-circle" size={25} color={theme.colors.accent} />
                      </View>
                      <UiText weight="700" style={styles.greeting}>{copy.greeting}</UiText>
                      <UiText tone="muted" style={styles.emptySubtitle}>{copy.subtitle}</UiText>
                      <View style={styles.suggestionSection}>
                        <UiText tone="muted" style={styles.suggestedTitle}>{copy.suggestedTitle}</UiText>
                        <View style={styles.suggestions}>
                          {copy.suggested.map((suggestion) => (
                            <Pressable
                              key={suggestion}
                              accessibilityRole="button"
                              onPress={() => { void submitQuestion(suggestion); }}
                              style={[styles.suggestionCard, { borderColor: theme.colors.border }]}
                            >
                              <UiText style={{ flex: 1, fontSize: 13 }}>{suggestion}</UiText>
                              <Icon name={isArabic ? "arrow-up-left" : "arrow-up-right"} size={16} color={theme.colors.accent} />
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </View>
                  ) : null}
                  {quotaRemaining !== null ? (
                    <UiText tone="muted" style={{ fontSize: 11, textAlign: isArabic ? "right" : "left" }}>
                      {isArabic ? "المتبقي اليوم: " + quotaRemaining + " من 50 رسالة" : quotaRemaining + " of 50 messages remaining today"}
                    </UiText>
                  ) : null}
                  {messages.map((message) => (
                    <View key={message.id} style={[styles.messageBubble, message.role === "assistant" ? styles.assistantMessage : styles.userMessage, message.role === "user" ? { backgroundColor: theme.colors.surfaceSecondary } : null]}>
                      <UiText>
                        {message.parts?.map((part, index) => part.link ? (
                          <UiText
                            key={message.id + "-part-" + index}
                            accessibilityRole="link"
                            accessibilityLabel={part.link.label}
                            onPress={() => {
                              setChatOpen(false);
                              router.push(part.link.route as never);
                            }}
                            style={{ color: theme.colors.accent, textDecorationLine: "underline", fontWeight: "700" }}
                          >
                            {part.text}
                          </UiText>
                        ) : <UiText key={message.id + "-part-" + index}>{part.text}</UiText>) ?? message.text}
                      </UiText>
                    </View>
                  ))}
                  {isSending ? <UiText tone="muted" style={{ fontSize: 12 }}>{isArabic ? "Arownd Aide يكتب..." : "Arownd Aide is responding..."}</UiText> : null}
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
                    multiline
                    maxLength={4000}
                    textAlignVertical="center"
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
  panel: { flex: 1, borderRadius: 0, borderWidth: 0, paddingHorizontal: 22, gap: 18, height: "100%", maxHeight: "100%" },
  tourPanel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, gap: 18, height: "78%", maxHeight: "78%" },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  assistantMark: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 2 },
  headerAction: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(128,128,128,0.10)" },
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
  chatScrollContent: { flexGrow: 1, gap: 18, paddingTop: 12, paddingBottom: 18 },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "stretch", gap: 14, paddingBottom: 18 },
  emptyMark: { width: 52, height: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  greeting: { fontSize: 23, lineHeight: 32, textAlign: "center" },
  emptySubtitle: { fontSize: 14, lineHeight: 22, textAlign: "center", maxWidth: 300, alignSelf: "center" },
  suggestionSection: { gap: 10, marginTop: 24 },
  suggestedTitle: { fontSize: 12, fontWeight: "600" },
  messageBubble: { maxWidth: "92%", padding: 12, borderRadius: 16, gap: 10 },
  assistantMessage: { alignSelf: "stretch", maxWidth: "100%", paddingHorizontal: 0, paddingVertical: 4 },
  userMessage: { alignSelf: "flex-end" },
  suggestions: { flexDirection: "column", gap: 9 },
  suggestionCard: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  inputRow: { minHeight: 58, borderWidth: 1, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, paddingVertical: 8, fontSize: 14 },
  sendButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" }
});
