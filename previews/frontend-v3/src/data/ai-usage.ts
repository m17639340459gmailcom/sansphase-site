export type AIUsageEntry = Readonly<{
  id: string;
  name: string;
  tokens: number;
}>;

// Cumulative totals supplied manually by the site owner; 1 B = 1,000,000,000 tokens.
export const aiUsageEntries = [
  { id: "claude", name: "Claude", tokens: 5_700_000_000 },
  { id: "codex", name: "Codex", tokens: 36_800_000_000 },
  { id: "deepseek", name: "DeepSeek", tokens: 14_300_000_000 },
] as const satisfies readonly AIUsageEntry[];

export const totalAITokens = aiUsageEntries.reduce((total, entry) => total + entry.tokens, 0);

export function formatAITokens(tokens: number, locale: string): string {
  const isChinese = /^zh(?:-|$)/i.test(locale);
  const value = tokens / (isChinese ? 100_000_000 : 1_000_000_000);
  const formattedValue = new Intl.NumberFormat(locale, {
    minimumFractionDigits: isChinese ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value);

  return `${formattedValue}${isChinese ? " 亿" : "B"}`;
}

export type RankedAIUsage = readonly (AIUsageEntry & Readonly<{ share: number }>)[];

/** Descending by tokens, each with its share of the total. Never mutates `entries`. */
export function rankAIUsage(entries: readonly AIUsageEntry[]): { total: number; ranked: RankedAIUsage } {
  const total = entries.reduce((sum, entry) => sum + entry.tokens, 0);
  const ranked = [...entries]
    .sort((left, right) => right.tokens - left.tokens)
    .map((entry) => ({ ...entry, share: total > 0 ? entry.tokens / total : 0 }));
  return { total, ranked };
}

export const rankedAIUsage: RankedAIUsage = rankAIUsage(aiUsageEntries).ranked;
