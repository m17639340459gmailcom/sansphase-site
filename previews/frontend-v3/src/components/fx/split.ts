export type SplitBy = "auto" | "char" | "word";

/** A breakable group (word or CJK glyph); `units` animate individually with a global `index`. */
export type SplitSegment =
  | { type: "space" }
  | { type: "word"; units: { text: string; index: number }[] };

const CJK_RANGE = "\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3100-\u312f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef";
// Kinsoku: closing marks never start a line, opening marks never end one.
const CLOSING = "\u3002\uff0c\u3001\uff1b\uff1a\uff1f\uff01\uff09\u300d\u300f\u3011\u300b\u3009\u2026\u2014\uff05,.;:?!)\\]}\u201d\u2019";
const OPENING = "\uff08\u300c\u300e\u3010\u300a\u3008(\\[{\u201c\u2018";

const CJK = new RegExp(`[${CJK_RANGE}]`);
const TOKENS = new RegExp(
  `\\s+|[${OPENING}]*(?:[${CJK_RANGE}][${CLOSING}]*|[^\\s${CJK_RANGE}]+[${CLOSING}]*)`,
  "g",
);

export function isCjk(char: string) {
  return CJK.test(char);
}

/** Deterministic (SSR-safe) split: Latin by word, CJK by glyph with punctuation attached. */
export function splitText(text: string, by: SplitBy = "auto"): SplitSegment[] {
  const segments: SplitSegment[] = [];
  let index = 0;
  const tokens = by === "word" ? text.split(/(\s+)/).filter(Boolean) : (text.match(TOKENS) ?? []);
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (segments.length && segments.at(-1)?.type !== "space") segments.push({ type: "space" });
      continue;
    }
    const parts = by === "char" && !isCjk(token) ? Array.from(token) : [token];
    segments.push({ type: "word", units: parts.map((part) => ({ text: part, index: index++ })) });
  }
  if (segments.at(-1)?.type === "space") segments.pop();
  return segments;
}

/** Number of animated units, e.g. to chain the delay of a following SplitText. */
export function countUnits(text: string | undefined, by: SplitBy = "auto") {
  if (!text) return 0;
  return splitText(text, by).reduce((sum, segment) => sum + (segment.type === "word" ? segment.units.length : 0), 0);
}
