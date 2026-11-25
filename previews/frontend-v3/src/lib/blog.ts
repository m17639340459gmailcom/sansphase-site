import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { unstable_cache } from "next/cache";
import { routing, type Locale } from "@/i18n/routing";
import { publicSupabase } from "./supabase/public";
import { readingTime } from "./utils";

export type PostMeta = {
  slug: string;
  locale: Locale;
  title: string;
  description: string;
  date: string;
  updated?: string;
  tags: string[];
  hue: number;
  cover?: string;
  coverAlt?: string;
  coverSize?: { width: number; height: number };
  readingMinutes: number;
  /** True when the post is served from the configured default locale. */
  fallback: boolean;
};

export type Post = PostMeta & { content: string };

const CONTENT_DIR = path.join(process.cwd(), "content", "blog");

/** Cache tag for posts stored in the database; admin saves revalidate it. */
export const POSTS_TAG = "posts";

/** Covers are either local editorial artwork or uploads in the Supabase `media` bucket. */
export function isAllowedCover(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^\/images\/blog\/[a-z0-9-]+\.(webp|png|jpg)$/.test(value) ||
      /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/media\/[\w./-]+\.(webp|png|jpe?g|avif|gif)$/.test(value))
  );
}

type StoredPost = {
  slug: string;
  locale: Locale;
  title: string;
  description: string;
  date: string;
  tags: string[];
  hue: number;
  cover: string | null;
  cover_alt: string | null;
  body: string;
};

/** Published posts from the database (edited in the admin). They take precedence over files. */
const readStoredPosts = unstable_cache(
  async (): Promise<StoredPost[]> => {
    const supabase = publicSupabase();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("posts")
      .select("slug, locale, title, description, date, tags, hue, cover, cover_alt, body")
      .eq("status", "published");
    return error || !data ? [] : (data as StoredPost[]);
  },
  ["posts", "published"],
  { tags: [POSTS_TAG], revalidate: 3600 },
);

async function storedPosts(): Promise<StoredPost[]> {
  try {
    return await readStoredPosts();
  } catch {
    return [];
  }
}

function fromStored(row: StoredPost, fallback: boolean): Post {
  return {
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    description: row.description,
    date: row.date,
    tags: row.tags,
    hue: row.hue,
    cover: isAllowedCover(row.cover) ? row.cover : undefined,
    coverAlt: row.cover_alt ?? undefined,
    readingMinutes: readingTime(row.body, row.locale),
    fallback,
    content: row.body,
  };
}

async function listFileSlugs(locale: Locale): Promise<string[]> {
  try {
    const files = await fs.readdir(path.join(CONTENT_DIR, locale));
    return files.filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
  } catch {
    return [];
  }
}

async function listSlugs(locale: Locale): Promise<string[]> {
  const [files, stored] = await Promise.all([listFileSlugs(locale), storedPosts()]);
  return Array.from(new Set([...files, ...stored.filter((post) => post.locale === locale).map((post) => post.slug)]));
}

/** Raw MDX file (front matter + body) for the admin's "import to edit" action. */
export async function readPostFile(locale: Locale, slug: string) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const { data, content } = matter(await fs.readFile(path.join(CONTENT_DIR, locale, `${slug}.mdx`), "utf8"));
    return { data: data as Record<string, unknown>, content };
  } catch {
    return null;
  }
}

/** Every post that exists as a file, for the admin list. */
export async function listFilePosts() {
  const lists = await Promise.all(
    routing.locales.map(async (locale) => {
      const slugs = await listFileSlugs(locale);
      const posts = await Promise.all(slugs.map((slug) => readFilePost(locale, slug)));
      return posts.filter((post): post is Post => post !== null);
    }),
  );
  return lists.flat().map((post) => ({ slug: post.slug, locale: post.locale, title: post.title, date: post.date }));
}

async function readPost(locale: Locale, slug: string, fallback = false): Promise<Post | null> {
  const stored = (await storedPosts()).find((post) => post.slug === slug && post.locale === locale);
  return stored ? fromStored(stored, fallback) : readFilePost(locale, slug, fallback);
}

async function readFilePost(locale: Locale, slug: string, fallback = false): Promise<Post | null> {
  const file = path.join(CONTENT_DIR, locale, `${slug}.mdx`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const { data, content } = matter(raw);
    return {
      slug,
      locale,
      title: String(data.title ?? slug),
      description: String(data.description ?? ""),
      date: String(data.date ?? "2026-01-01"),
      updated: data.updated ? String(data.updated) : undefined,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      hue: typeof data.hue === "number" ? data.hue : 24,
      cover: isAllowedCover(data.cover) ? data.cover : undefined,
      coverAlt: typeof data.coverAlt === "string" ? data.coverAlt : undefined,
      readingMinutes: readingTime(content, locale),
      fallback,
      content,
    };
  } catch {
    return null;
  }
}

/** All posts for a locale, falling back to the default locale for untranslated slugs. */
export async function getAllPosts(locale: string): Promise<PostMeta[]> {
  const loc = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
  const [own, base] = await Promise.all([listSlugs(loc), listSlugs(routing.defaultLocale)]);
  const slugs = Array.from(new Set([...own, ...base]));
  const posts = await Promise.all(
    slugs.map(async (slug) => {
      const post = own.includes(slug)
        ? await readPost(loc, slug)
        : await readPost(routing.defaultLocale, slug, true);
      if (!post) return null;
      const { content: _content, ...meta } = post;
      void _content;
      return meta;
    }),
  );
  return posts
    .filter((p): p is PostMeta => p !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export async function getPost(locale: string, slug: string): Promise<Post | null> {
  const loc = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  return (
    (await readPost(loc, slug)) ??
    (loc !== routing.defaultLocale ? readPost(routing.defaultLocale, slug, true) : null)
  );
}

export async function getAllSlugs(): Promise<string[]> {
  const lists = await Promise.all(routing.locales.map((l) => listSlugs(l)));
  return Array.from(new Set(lists.flat()));
}
