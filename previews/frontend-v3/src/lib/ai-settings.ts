import { z } from "zod";

export const AI_SETTINGS_KEY = "ai_settings";

export const aiSettingsSchema = z.object({
  /** Model id sent to the DeepSeek-compatible endpoint. */
  model: z.string().trim().regex(/^[\w.:/-]+$/, "模型名只能包含字母、数字和 . _ - : /").max(80),
  /** Long posts are split at headings into pieces of at most this many characters. */
  chunkChars: z.number().int().min(2000).max(200_000),
  /** `max_tokens` for each request; must not exceed what the model allows. */
  maxTokens: z.number().int().min(1024).max(393_216),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/**
 * Defaults for DeepSeek-V4.1-Flash, whose API model name is `deepseek-flash`: 1M context and up to
 * 384K output tokens (the API accepts `max_tokens` in [1, 393216]). A post body is capped at
 * 200,000 characters, which fits in one request, so by default nothing is split.
 */
export const defaultAiSettings: AiSettings = {
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
  chunkChars: 200_000,
  maxTokens: 393_216,
};

/** Stored settings merged over the defaults; anything invalid falls back to the defaults. */
export function resolveAiSettings(value: unknown): AiSettings {
  const parsed = aiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultAiSettings;
}
