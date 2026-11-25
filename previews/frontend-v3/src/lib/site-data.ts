import "server-only";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { aiUsageEntries, type AIUsageEntry } from "@/data/ai-usage";
import { publicSupabase } from "@/lib/supabase/public";

/** Cache tag for everything read from the `site_data` table; admin saves revalidate it. */
export const SITE_DATA_TAG = "site-data";
export const AI_USAGE_KEY = "ai_usage";

export const aiUsageSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40),
      name: z.string().trim().min(1).max(40),
      tokens: z.number().int().min(0).max(1e15),
    }),
  )
  .min(1)
  .max(12)
  .refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length, "duplicate id");

const readAIUsage = unstable_cache(
  async (): Promise<AIUsageEntry[] | null> => {
    const supabase = publicSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase.from("site_data").select("value").eq("key", AI_USAGE_KEY).maybeSingle();
    if (error || !data) return null;
    const parsed = aiUsageSchema.safeParse(data.value);
    return parsed.success ? parsed.data : null;
  },
  ["site-data", AI_USAGE_KEY],
  { tags: [SITE_DATA_TAG], revalidate: 3600 },
);

/** AI usage totals edited in the admin; the values in `src/data/ai-usage.ts` are the fallback. */
export async function getAIUsage(): Promise<readonly AIUsageEntry[]> {
  try {
    return (await readAIUsage()) ?? aiUsageEntries;
  } catch {
    return aiUsageEntries;
  }
}
