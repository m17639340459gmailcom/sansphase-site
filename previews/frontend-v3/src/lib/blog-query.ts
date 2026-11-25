export const POSTS_PER_PAGE = 12;

export type BlogSort = "newest" | "oldest" | "title";

type SearchablePost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: readonly string[];
  searchTerms?: readonly string[];
};

export type BlogQuery = {
  search?: string;
  sort?: BlogSort;
  page?: number;
  locale?: string;
};

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLowerCase().trim();
}

/** Filter before sorting and paging; never change the supplied post collection. */
export function queryBlogPosts<T extends SearchablePost>(
  posts: readonly T[],
  { search = "", sort = "newest", page = 1, locale = "en" }: BlogQuery = {},
) {
  const terms = normalizeSearch(search).split(/\s+/).filter(Boolean);
  const filtered = posts.filter((post) => {
    const searchable = normalizeSearch([post.title, post.description, ...post.tags, ...(post.searchTerms ?? [])].join(" "));
    return terms.every((term) => searchable.includes(term));
  });
  const titleOrder = new Intl.Collator(locale, { sensitivity: "base", numeric: true });

  filtered.sort((a, b) => {
    const order = sort === "title"
      ? titleOrder.compare(a.title, b.title)
      : sort === "oldest"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date);
    return order || a.slug.localeCompare(b.slug);
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  const requestedPage = Number.isFinite(page) ? Math.trunc(page) : 1;
  const currentPage = Math.max(1, Math.min(requestedPage, totalPages));
  const offset = (currentPage - 1) * POSTS_PER_PAGE;

  return {
    posts: filtered.slice(offset, offset + POSTS_PER_PAGE),
    total,
    totalPages,
    currentPage,
    start: total === 0 ? 0 : offset + 1,
    end: Math.min(offset + POSTS_PER_PAGE, total),
  };
}
