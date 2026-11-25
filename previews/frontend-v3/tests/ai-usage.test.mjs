import assert from "node:assert/strict";
import test from "node:test";
import {
  aiUsageEntries,
  formatAITokens,
  rankedAIUsage,
  totalAITokens,
} from "../src/data/ai-usage.ts";

test("AI usage preserves the site owner's exact cumulative totals", () => {
  assert.deepEqual(aiUsageEntries, [
    { id: "claude", name: "Claude", tokens: 5_700_000_000 },
    { id: "codex", name: "Codex", tokens: 36_800_000_000 },
    { id: "deepseek", name: "DeepSeek", tokens: 14_300_000_000 },
  ]);
  assert.equal(totalAITokens, 56_800_000_000);
  assert.equal(totalAITokens, aiUsageEntries.reduce((sum, entry) => sum + entry.tokens, 0));
});

test("AI usage ranking is descending without sorting or enriching the source array", () => {
  assert.deepEqual(rankedAIUsage.map((entry) => entry.id), ["codex", "deepseek", "claude"]);
  assert.deepEqual(aiUsageEntries.map((entry) => entry.id), ["claude", "codex", "deepseek"]);
  assert.notStrictEqual(rankedAIUsage, aiUsageEntries);

  for (const entry of rankedAIUsage) {
    const source = aiUsageEntries.find((candidate) => candidate.id === entry.id);
    assert.ok(source);
    assert.notStrictEqual(entry, source);
    assert.equal(entry.tokens, source.tokens);
    assert.equal(Object.hasOwn(source, "share"), false);
  }
});

test("AI usage bar shares use the total, not the largest entry", () => {
  for (const entry of rankedAIUsage) {
    assert.equal(entry.share, entry.tokens / 56_800_000_000);
    assert.ok(entry.share > 0 && entry.share < 1);
  }

  const totalShare = rankedAIUsage.reduce((sum, entry) => sum + entry.share, 0);
  assert.ok(Math.abs(totalShare - 1) < Number.EPSILON);
  assert.deepEqual(
    rankedAIUsage.map((entry) => (entry.share * 100).toFixed(1)),
    ["64.8", "25.2", "10.0"],
  );
});

for (const locale of ["zh", "zh-CN"]) {
  test(`AI token totals and ranked entries use 亿 for ${locale}`, () => {
    assert.equal(formatAITokens(totalAITokens, locale), "568 亿");
    assert.deepEqual(
      rankedAIUsage.map((entry) => formatAITokens(entry.tokens, locale)),
      ["368 亿", "143 亿", "57 亿"],
    );
  });
}

test("AI token totals and ranked entries use billions for English", () => {
  assert.equal(formatAITokens(totalAITokens, "en"), "56.8B");
  assert.deepEqual(
    rankedAIUsage.map((entry) => formatAITokens(entry.tokens, "en")),
    ["36.8B", "14.3B", "5.7B"],
  );
});

test("AI token formatting keeps up to one Chinese decimal and exactly one English decimal", () => {
  assert.equal(formatAITokens(1_000_000_000, "zh"), "10 亿");
  assert.equal(formatAITokens(150_000_000, "zh"), "1.5 亿");
  assert.equal(formatAITokens(156_000_000, "zh-CN"), "1.6 亿");
  assert.equal(formatAITokens(1_000_000_000, "en"), "1.0B");
});
