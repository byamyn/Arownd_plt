import { router } from "expo-router";
import { useEffect } from "react";

export default function CaptchaReturnScreen() {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/login");
    }
  }, []);

  return null;
}
