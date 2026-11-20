import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase";

const TeamRoleSchema = z.enum(["owner", "admin", "staff"]);
const TeamMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: TeamRoleSchema,
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  email: z.string().email(),
  created_at: z.string()
});
const TeamInvitationSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  invited_email: z.string().email(),
  role: z.enum(["admin", "staff"]),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expires_at: z.string(),
  created_at: z.string()
});
const PendingTeamInvitationSchema = z.object({
  invitation_id: z.string().uuid(),
  store_id: z.string().uuid(),
  store_name: z.string(),
  role: z.enum(["admin", "staff"]),
  expires_at: z.string(),
  invited_email: z.string().email()
});

export type StoreTeamRole = z.infer<typeof TeamRoleSchema>;
export type StoreTeamMember = z.infer<typeof TeamMemberSchema>;
export type StoreTeamInvitation = z.infer<typeof TeamInvitationSchema>;
export type PendingStoreTeamInvitation = z.infer<typeof PendingTeamInvitationSchema>;

export const storeTeamInvitationSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["admin", "staff"])
});
export type StoreTeamInvitationInput = z.infer<typeof storeTeamInvitationSchema>;

export async function fetchStoreTeamMembers(storeId: string, signal?: AbortSignal): Promise<StoreTeamMember[]> {
  let request = getSupabaseClient().rpc("get_store_team_members", { _store_id: storeId });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return TeamMemberSchema.array().parse(data as unknown);
}

export async function fetchStoreTeamInvitations(storeId: string, signal?: AbortSignal): Promise<StoreTeamInvitation[]> {
  let request = getSupabaseClient()
    .from("store_team_invitations")
    .select("id, store_id, invited_email, role, status, expires_at, created_at")
    .eq("store_id", storeId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return TeamInvitationSchema.array().parse(data as unknown);
}

export async function inviteStoreTeamMember(input: {
  storeId: string;
  email: string;
  role: "admin" | "staff";
}): Promise<string> {
  const values = storeTeamInvitationSchema.parse({ email: input.email, role: input.role });
  const email = values.email.toLowerCase();
  const { data, error } = await getSupabaseClient().rpc("invite_store_team_member", {
    _store_id: input.storeId,
    _email: email,
    _role: input.role
  });
  if (error) throw error;
  return data === null ? null : z.string().uuid().parse(data as unknown);
}

export async function revokeStoreTeamInvitation(invitationId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("revoke_store_team_invitation", {
    _invitation_id: invitationId
  });
  if (error) throw error;
}

export async function updateStoreTeamMemberRole(input: {
  storeId: string;
  userId: string;
  role: "admin" | "staff";
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_store_team_member_role", {
    _store_id: input.storeId,
    _user_id: input.userId,
    _role: input.role
  });
  if (error) throw error;
}

export async function removeStoreTeamMember(input: {
  storeId: string;
  userId: string;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("remove_store_team_member", {
    _store_id: input.storeId,
    _user_id: input.userId
  });
  if (error) throw error;
}

export async function fetchMyPendingStoreTeamInvitations(signal?: AbortSignal): Promise<PendingStoreTeamInvitation[]> {
  let request = getSupabaseClient().rpc("get_my_pending_store_team_invitations");
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return PendingTeamInvitationSchema.array().parse(data as unknown);
}

export async function acceptStoreTeamInvitation(invitationId: string): Promise<string | null> {
  const { data, error } = await getSupabaseClient().rpc("accept_store_team_invitation", {
    _invitation_id: invitationId
  });
  if (error) throw error;
  return z.string().uuid().parse(data as unknown);
}
