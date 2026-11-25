import render from "dom-serializer";
import GithubSlugger from "github-slugger";
import { DomUtils, parseDocument } from "htmlparser2";
import type { TocItem } from "@/components/blog/table-of-contents";

/** Add navigation anchors to HTML already sanitized by the existing site service. */
export function prepareSiteRichText(source: string) {
  const document = parseDocument(source);
  const slugger = new GithubSlugger();
  const toc: TocItem[] = [];
  for (const heading of DomUtils.findAll((node) => node.name === "h2" || node.name === "h3", document.children)) {
    const text = DomUtils.textContent(heading).trim();
    if (!text) continue;
    const id = `section-${slugger.slug(text) || toc.length + 1}`;
    heading.attribs.id = id;
    toc.push({ id, text, depth: heading.name === "h2" ? 2 : 3 });
  }
  return { html: render(document, { encodeEntities: "utf8" }), text: DomUtils.textContent(document), toc };
}
