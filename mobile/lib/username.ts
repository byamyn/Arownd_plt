import { usernameSchema } from "@/lib/auth-validation";
import { getSupabaseClient } from "@/lib/supabase";

export async function claimMyUsername(value: string): Promise<void> {
  const username = usernameSchema.parse(value);
  const { error } = await getSupabaseClient().rpc("claim_my_username", {
    _username: username
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("profiles_username_lower_uidx") || message.includes("duplicate key")) {
      throw new Error("USERNAME_TAKEN");
    }
    if (message.includes("username_invalid")) throw new Error("USERNAME_INVALID");
    if (message.includes("username_reserved")) throw new Error("USERNAME_RESERVED");
    throw error;
  }
}

export async function setMyProfileVisibility(isPublic: boolean): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_my_profile_visibility", {
    _is_public: isPublic
  });
  if (error) throw error;
}
