export type SiteBookPosition = { block: string; offset: number };
export const PUBLISHED_BOOK_BODY_ID = "published-book-body";

export function siteBookPosition(block: unknown, offset: unknown): SiteBookPosition | null {
  if (typeof block !== "string" || !/^[a-z\d_-]{1,200}$/i.test(block)) return null;
  const parsed = typeof offset === "string" && /^(?:0|[1-9]\d{0,15})$/.test(offset) ? Number(offset) : offset;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) return null;
  return { block, offset: parsed };
}

export function siteBookPositionQuery(position: SiteBookPosition) {
  return new URLSearchParams({ block: position.block, offset: String(position.offset) }).toString();
}
