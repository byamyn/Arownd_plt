import { useEffect, useState } from "react";

import { Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { getSupabaseClient } from "@/lib/supabase";
import { fetchHomeProducts } from "@/lib/catalog";
import { syncSelectedCountryCodeFromProfile } from "@/lib/country-service";
import { LoadingState } from "@/components/ui";
import { translate, useLanguage } from "@/lib/i18n";

type Destination = "/login" | "/home";

export default function IndexRoute() {
  useLanguage();
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    let active = true;

    const resolveDestination = async (): Promise<void> => {
      try {
        const { data, error } = await getSupabaseClient().auth.getSession();
        if (active) {
          if (!error && data.session) {
            void queryClient.prefetchQuery({
              queryKey: ["customer-home-products"],
              queryFn: ({ signal }) => fetchHomeProducts(signal),
              staleTime: 60_000
            });
            await syncSelectedCountryCodeFromProfile(data.session.user.id);
            if (active) setDestination("/home");
            return;
          }
          if (active) setDestination("/login");
        }
      } catch {
        if (active) setDestination("/login");
      }
    };

    void resolveDestination();

    return () => {
      active = false;
    };
  }, [queryClient]);

  if (destination) return <Redirect href={destination} />;

  return <LoadingState label={translate("stateLoading")} />;
}