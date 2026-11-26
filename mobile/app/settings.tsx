import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";

import { CustomerMainHeader } from "@/components/customer-main-header";
import { CustomerScreen, ErrorState, PageSkeleton } from "@/components/customer-ui";
import { Button, Caption } from "@/components/ui";
import { ProfileSettingsSection } from "@/components/profile-settings-section";
import { translate } from "@/lib/i18n";
import { getSupabaseClient } from "@/lib/supabase";

export default function SettingsScreen() {
  const user = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().auth.getUser();
      if (error) throw error;
      return data.user;
    },
    retry: false
  });

  if (user.isPending) {
    return (
      <CustomerScreen showNavigation={false}>
        <CustomerMainHeader variant="profile" />
        <PageSkeleton variant="profile" rows={3} />
      </CustomerScreen>
    );
  }

  if (user.isError) {
    return (
      <CustomerScreen showNavigation={false} refreshing={user.isFetching} onRefresh={() => { void user.refetch(); }}>
        <CustomerMainHeader variant="profile" />
        <ErrorState
          title={translate("profileLoadError")}
          retryLabel={translate("retry")}
          busy={user.isFetching}
          onRetry={() => void user.refetch()}
        />
      </CustomerScreen>
    );
  }

  if (!user.data) {
    return (
      <CustomerScreen showNavigation={false}>
        <CustomerMainHeader variant="profile" />
        <Caption>{translate("profileLoginHint")}</Caption>
        <Button label={translate("profileLogin")} onPress={() => router.push("/login")} fullWidth />
      </CustomerScreen>
    );
  }

  return <ProfileSettingsSection />;
}
