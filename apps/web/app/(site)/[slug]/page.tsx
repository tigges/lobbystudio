import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ContentPage, pageTitle } from "../content-page";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: await pageTitle(slug) };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  if (slug === "contact") redirect("/");
  return <ContentPage slug={slug} />;
}
