import { Stack } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CustomerNavigation } from "@/components/customer-navigation";
import { useAppTheme } from "@/lib/theme";
import { useLanguage } from "@/lib/i18n";

export default function MerchantLayout() {
  const theme = useAppTheme();
  const { language } = useLanguage();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: language === "ar" ? "slide_from_left" : "slide_from_right",
          contentStyle: { backgroundColor: theme.colors.background }
        }}
      />
      <SafeAreaView
        edges={["bottom", "left", "right"]}
        style={{ backgroundColor: theme.colors.surface }}
      >
        <CustomerNavigation />
      </SafeAreaView>
    </View>
  );
}
