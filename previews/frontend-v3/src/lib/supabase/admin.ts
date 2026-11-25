import "server-only";
import { redirect } from "next/navigation";
import { serverSupabase } from "./server";

export type AdminSession = {
  supabase: NonNullable<Awaited<ReturnType<typeof serverSupabase>>>;
  user: { id: string; login: string; avatar: string | null };
};

/** Current session plus whether it belongs to an allowlisted admin (checked in the database). */
export async function getAdminState() {
  const supabase = await serverSupabase();
  if (!supabase) return { status: "unconfigured" as const };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { status: "anonymous" as const };
  const { data: allowed } = await supabase.rpc("is_admin");
  const meta = data.user.user_metadata as { user_name?: string; avatar_url?: string };
  const user = { id: data.user.id, login: meta.user_name ?? data.user.email ?? "user", avatar: meta.avatar_url ?? null };
  return allowed === true
    ? { status: "admin" as const, supabase, user }
    : { status: "forbidden" as const, user };
}

/** Guard for admin pages and actions: anything but an admin session goes to the login screen. */
export async function requireAdmin(): Promise<AdminSession> {
  const state = await getAdminState();
  if (state.status !== "admin") redirect("/admin/login");
  return { supabase: state.supabase, user: state.user };
}
