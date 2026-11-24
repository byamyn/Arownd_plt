import { usernameSchema } from "@/lib/auth-validation";
import { getSupabaseClient } from "@/lib/supabase";

export async function claimMyUsername(value: string): Promise<void> {
  const username = usernameSchema.parse(value);
  const { error } = await getSupabaseClient().rpc("claim_my_username", {
    _username: username
  });
  if (error) throw error;
}
