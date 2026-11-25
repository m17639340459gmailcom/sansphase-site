import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let client: SupabaseClient | null | undefined;

/** Cookie-less anonymous client for public reads (published content); safe in static rendering. */
export function publicSupabase() {
  if (client !== undefined) return client;
  const env = supabaseEnv();
  client = env ? createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}
