import "server-only";
import type { AiSettings } from "./ai-settings";

const ENDPOINT = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "") + "/chat/completions";

export const LANGUAGES = { zh: "Simplified Chinese", en: "English" } as const;
export type Language = keyof typeof LANGUAGES;

const MDX_RULES = `The text is MDX (Markdown plus JSX components) from a technical blog.
- Keep every Markdown structure exactly: headings and their levels, lists, tables, blockquotes, links, emphasis.
- Never change fenced code blocks, inline code, URLs, file paths, or JSX tag and attribute names.
- Inside JSX tags such as <BlogImage ... />, only the values of alt and caption are prose; leave src, width and height untouched.
- Return only the resulting MDX. No explanations, no surrounding code fence.`;

export function translatePrompt(from: Language, to: Language) {
  return `You are a professional technical translator. Translate the user's text from ${LANGUAGES[from]} to ${LANGUAGES[to]}.
${MDX_RULES}
- Translate faithfully and naturally, as a native ${LANGUAGES[to]} technical writer would phrase it. Do not add, drop or soften content.
- Keep product names, model names and code identifiers in their original form.`;
}

export function polishPrompt(language: Language) {
  return `You are a careful editor. Polish the user's ${LANGUAGES[language]} text so it reads clearly and naturally.
${MDX_RULES}
- Keep the language, the meaning, every fact and number, the author's first-person voice and the paragraph structure.
- Fix awkward phrasing, repetition, grammar and punctuation. Prefer plain, direct wording; do not make it more promotional or add new claims.
- If a passage is already fine, leave it as it is.`;
}

export const META_PROMPT = (from: Language, to: Language) =>
  `Translate the fields of the user's JSON object from ${LANGUAGES[from]} to ${LANGUAGES[to]} for a technical blog. ` +
  `Return a JSON object with exactly the same keys: "title" (string), "description" (string), "coverAlt" (string), "tags" (array of short strings). ` +
  `Keep product and model names unchanged. Output JSON only.`;

/**
 * Splits MDX at level-2 headings (outside code fences) into chunks of at most `limit` characters,
 * so each request stays within the model's output limit.
 */
export function splitSections(source: string, limit: number) {
  const sections: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^##\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join("\n"));

  const chunks: string[] = [];
  for (const section of sections) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + section.length + 1 <= limit) chunks[chunks.length - 1] = `${last}\n${section}`;
    else chunks.push(section);
  }
  return chunks;
}

export function aiConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

async function request(settings: AiSettings, system: string, user: string, options: { stream: boolean; json?: boolean; signal?: AbortSignal }) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: settings.model,
      stream: options.stream,
      temperature: 0.3,
      max_tokens: settings.maxTokens,
      // Translation and polishing gain little from the reasoning pass; skipping it is faster and cheaper.
      thinking: { type: "disabled" },
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`模型接口返回 ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return response;
}

/** One non-streaming completion that must return a JSON object. */
export async function completeJson(settings: AiSettings, system: string, user: string, signal?: AbortSignal): Promise<unknown> {
  const response = await request(settings, system, user, { stream: false, json: true, signal });
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

/** Streams one completion, calling `onText` for every piece of generated text. */
export async function streamCompletion(settings: AiSettings, system: string, user: string, onText: (text: string) => void, signal?: AbortSignal) {
  const response = await request(settings, system, user, { stream: true, signal });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("模型接口没有返回内容。");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) onText(delta);
      } catch {
        // Keep-alive comments and partial frames are not JSON; skip them.
      }
    }
  }
}
