import { Marked } from "marked";
import { DEFAULT_TENANT, promotedPages, slugify } from "@dental-bot/core";

export const SITE_TENANT = process.env.SITE_TENANT ?? DEFAULT_TENANT;

export const PRACTICE = {
  address: ["14 Quayside Row", "Rotherhithe", "London SE16 4ZZ"],
  email: "hello@harbourdental.example",
};

export async function sitePages() {
  return promotedPages(SITE_TENANT);
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
