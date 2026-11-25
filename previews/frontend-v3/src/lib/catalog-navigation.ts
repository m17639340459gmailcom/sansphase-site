export const catalogPaths = {
  works: "/projects",
  resources: "/learning",
  software: "/software",
} as const;

export type CatalogKind = keyof typeof catalogPaths;
export type CatalogQuery = { page: number; category: string; q: string };
type Search = Record<string, string | string[] | undefined>;

function value(param: Search[string]) {
  return typeof param === "string" ? param.trim() : "";
}

export function catalogQuery(search: Search): CatalogQuery {
  const page = Number(value(search.page));
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    category: value(search.category).slice(0, 200) || "all",
    q: value(search.q).slice(0, 200),
  };
}

export function catalogHref(kind: CatalogKind, query: CatalogQuery) {
  const params = new URLSearchParams();
  if (query.category !== "all") params.set("category", query.category);
  if (query.q) params.set("q", query.q);
  if (query.page > 1) params.set("page", String(query.page));
  return catalogPaths[kind] + (params.size ? `?${params}` : "");
}
