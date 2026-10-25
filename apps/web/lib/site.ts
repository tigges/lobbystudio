import { Marked } from "marked";
import { promotedPages, slugify } from "@dental-bot/core";
import { currentTenant } from "./business";

export { SITE_TENANT } from "./business";

export async function sitePages() {
  const tenant = await currentTenant();
  return { tenant, ...(await promotedPages(tenant)) };
}

export function pageHref(slug: string) {
  return slug === "contact" ? "/" : `/${slug}`;
}

/** H2 ids match the retrieval chunk anchors, so a cited source links to the exact section. */
const marked = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      const inner = this.parser.parseInline(tokens);
      return depth === 2 ? `<h2 id="${slugify(text)}">${inner}</h2>\n` : `<h${depth}>${inner}</h${depth}>\n`;
    },
  },
});

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}
