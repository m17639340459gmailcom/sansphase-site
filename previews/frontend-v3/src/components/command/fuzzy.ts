/**
 * fzf-style fuzzy matching: an optimal alignment that rewards word starts and
 * consecutive runs and penalises gaps. Indices are code points of the original text.
 */
export type FuzzyMatch = { score: number; indices: number[] };

export type Searchable = {
  label: string;
  /** Aliases searched with slightly less weight (other-locale names, tags, stack). */
  keywords?: readonly string[];
  /** Secondary text, matched as a plain substring only (fuzzy hits in prose are noise). */
  detail?: string;
};

export type Ranked = {
  score: number;
  /** Matched code points of `label`. */
  label: number[];
  /** The alias that matched when the label did not. */
  via?: { text: string; indices: number[] };
};

const SEPARATOR = /[\s\-_/.:·,，、|()（）[\]「」【】—–]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const MATCH = 16;
const CONSECUTIVE = 12;
const GAP_OPEN = 3;
const GAP_EXTEND = 1;
/** An alias must clearly beat the visible label before the row explains itself with it. */
const KEYWORD_WEIGHT = 0.8;
/** Minimum score per query character; scattered hits below it are rejected. */
const MIN_PER_CHAR = 13;
/** A lone character only counts at a word start (or on any CJK glyph). */
const MIN_SCORE = 20;
const NONE = -1e9;

/** One comparable character per code point (case- and accent-insensitive), so indices map 1:1. */
export function fold(char: string) {
  const base = char.normalize("NFKD").replace(/\p{M}/gu, "") || char;
  return Array.from(base.toLowerCase())[0] ?? char;
}

function foldAll(text: string) {
  return Array.from(text, fold).join("");
}

function boundary(chars: string[], i: number) {
  if (i === 0) return 10;
  const char = chars[i];
  const prev = chars[i - 1];
  if (SEPARATOR.test(prev)) return 8;
  if (CJK.test(char)) return 3;
  if (/\p{Lu}/u.test(char) && /\p{Ll}/u.test(prev)) return 7;
  if (/\d/u.test(char) && !/\d/u.test(prev)) return 5;
  return 0;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = Array.from(query, fold);
  const source = Array.from(text);
  const t = source.map(fold);
  const m = q.length;
  const n = t.length;
  if (!m) return { score: 0, indices: [] };
  if (m > n) return null;

  // Cheap subsequence check before the O(m·n) pass.
  for (let i = 0, j = 0; i < m; i++, j++) {
    while (j < n && t[j] !== q[i]) j++;
    if (j === n) return null;
  }

  const bonus = source.map((_, i) => boundary(source, i));
  const score = new Float64Array(m * n).fill(NONE);
  const from = new Int32Array(m * n).fill(-1);

  for (let j = 0; j < n; j++) {
    if (t[j] === q[0]) score[j] = MATCH + bonus[j] * 2 - Math.min(j, 16) * 0.5;
  }
  for (let i = 1; i < m; i++) {
    const row = i * n;
    const above = row - n;
    // Best earlier hit of q[i - 1] that leaves at least one character before j (affine gap).
    let gap = NONE;
    let gapFrom = -1;
    for (let j = i; j < n; j++) {
      gap -= GAP_EXTEND;
      if (j >= 2 && score[above + j - 2] - GAP_OPEN > gap) {
        gap = score[above + j - 2] - GAP_OPEN;
        gapFrom = j - 2;
      }
      if (t[j] !== q[i]) continue;
      const adjacent = score[above + j - 1] + CONSECUTIVE;
      const best = Math.max(adjacent, gap);
      if (best < NONE / 2) continue;
      score[row + j] = best + MATCH + bonus[j];
      from[row + j] = adjacent >= gap ? j - 1 : gapFrom;
    }
  }

  const last = (m - 1) * n;
  let end = -1;
  let best = NONE;
  for (let j = m - 1; j < n; j++) {
    if (score[last + j] > best) {
      best = score[last + j];
      end = j;
    }
  }
  if (end < 0 || best < Math.max(m * MIN_PER_CHAR, MIN_SCORE)) return null;

  const indices = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i--) {
    indices[i] = j;
    j = from[i * n + j];
  }
  // Precision over recall: a hit must start on a word or hold most of the query in one run.
  let run = 1;
  let longest = 1;
  for (let i = 1; i < m; i++) {
    run = indices[i] === indices[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  if (bonus[indices[0]] === 0 && longest < Math.ceil(m * 0.75)) return null;
  // Short, fully covered targets win ties ("Blog" over "Back to blog").
  return { score: best + (m / n) * 12 + (m === n ? 8 : 0), indices };
}

/** Whitespace-separated tokens; every token must match the label, an alias, or the detail. */
export function tokenize(query: string) {
  return query.trim().split(/\s+/u).filter(Boolean);
}

export function rank(tokens: readonly string[], item: Searchable): Ranked | null {
  let total = 0;
  const label = new Set<number>();
  let via: Ranked["via"];

  for (const token of tokens) {
    let best = NONE;
    let hit: { text: string; indices: number[]; own: boolean } | null = null;

    const own = fuzzyMatch(token, item.label);
    if (own) {
      best = own.score;
      hit = { text: item.label, indices: own.indices, own: true };
    }
    for (const keyword of item.keywords ?? []) {
      const match = fuzzyMatch(token, keyword);
      if (match && match.score * KEYWORD_WEIGHT > best) {
        best = match.score * KEYWORD_WEIGHT;
        hit = { text: keyword, indices: match.indices, own: false };
      }
    }
    const length = Array.from(token).length;
    if (item.detail && best < NONE / 2 && length > 1 && foldAll(item.detail).includes(foldAll(token))) {
      best = 8 + length * 6;
      hit = null;
    }
    if (best < NONE / 2) return null;

    total += best;
    if (hit?.own) hit.indices.forEach((index) => label.add(index));
    else if (hit && !via) via = { text: hit.text, indices: hit.indices };
  }

  return { score: total, label: [...label].sort((a, b) => a - b), via };
}
