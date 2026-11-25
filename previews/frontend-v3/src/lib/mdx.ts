import "server-only";
import GithubSlugger from "github-slugger";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode, { type Options as PrettyCodeOptions } from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { mdxComponents } from "@/components/blog/mdx-components";
import type { TocItem } from "@/components/blog/table-of-contents";

const prettyCode: PrettyCodeOptions = {
  theme: { light: "github-light", dark: "github-dark-dimmed" },
  keepBackground: false,
  defaultLang: "plaintext",
};

export async function renderMdx(source: string) {
  const { content } = await compileMDX({
    source,
    components: mdxComponents,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: "wrap" }],
          [rehypePrettyCode, prettyCode],
        ],
      },
    },
  });
  return content;
}

/** Builds a table of contents from `##` / `###` headings, matching rehype-slug ids. */
export function extractToc(markdown: string): TocItem[] {
  const slugger = new GithubSlugger();
  const items: TocItem[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[*_`]/g, "").trim();
    items.push({ id: slugger.slug(text), text, depth: match[1].length === 2 ? 2 : 3 });
  }
  return items;
}
