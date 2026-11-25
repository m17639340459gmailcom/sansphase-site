import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Browser client for the admin area (sign-in, uploads). */
export function browserSupabase() {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase is not configured");
  return createBrowserClient(env.url, env.key);
}
