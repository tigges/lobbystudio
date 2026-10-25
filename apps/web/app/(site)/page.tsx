import type { Metadata } from "next";
import { ContentPage, pageTitle } from "./content-page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await pageTitle("contact") };
}

export default function Home() {
  return <ContentPage slug="contact" />;
}
