import type { Metadata } from "next";
import { sitePages } from "@/lib/site";
import { ContentPage, pageTitle } from "./content-page";
import { Hero, Team, teamFromMarkdown, withoutTeamSection } from "./home";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await pageTitle("contact") };
}

export default async function Home() {
  const { bundle, pages } = await sitePages();
  const contact = pages.find((p) => p.slug === "contact")?.bodyMd ?? "";
  return (
    <>
      <div className="-mt-10">
        <Hero name={bundle.practice.name} phone={bundle.practice.phone} />
        <Team members={teamFromMarkdown(contact)} registered={/General Dental Council/.test(contact)} />
      </div>
      <div className="pt-10">
        <ContentPage slug="contact" transform={withoutTeamSection} secondary />
      </div>
    </>
  );
}
