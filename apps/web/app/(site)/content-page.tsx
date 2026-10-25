import { notFound } from "next/navigation";
import { renderMarkdown, sitePages } from "@/lib/site";
import { ChatButtons } from "./chat-buttons";

export async function ContentPage({ slug }: { slug: string }) {
  const { pages } = await sitePages();
  const page = pages.find((p) => p.slug === slug);
  if (!page) notFound();

  return (
    <article id="top">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-harbour-900 sm:text-4xl">{page.title}</h1>
      {slug === "book" && <ChatButtons />}
      <div className="content" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.bodyMd) }} />
    </article>
  );
}

export async function pageTitle(slug: string) {
  const { pages } = await sitePages();
  return pages.find((p) => p.slug === slug)?.title;
}
