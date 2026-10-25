import Link from "next/link";
import { BusinessSwitcher } from "@/app/business-switcher";
import { brandFor, paletteStyle } from "@/lib/brands";
import { buildLabel } from "@/lib/build";
import { currentTenant, switcherOptions } from "@/lib/business";
import { TestChatToggle } from "./ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Console" };

const NAV = [
  {
    group: "Team",
    links: [
      { href: "/console/handovers", label: "Handovers" },
      { href: "/console/help", label: "Help" },
    ],
  },
  {
    group: "Admin",
    links: [
      { href: "/console/insights", label: "Insights" },
      { href: "/console/conversations", label: "Conversations" },
    ],
  },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const tenant = await currentTenant();
  const brand = brandFor(tenant);
  return (
    <div className="min-h-screen bg-slate-50" style={paletteStyle(brand)}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <Link href="/console" className="font-semibold text-harbour-900">
            lobbystudio <span className="font-normal text-slate-400">console</span>
          </Link>
          <BusinessSwitcher current={tenant} options={switcherOptions()} tone="console" />
          <nav className="flex items-center gap-4 text-sm">
            {NAV.map((g) => (
              <div
                key={g.group}
                className={`flex items-center gap-1 rounded-xl px-1.5 py-1 ${g.group === "Admin" ? "bg-violet-50 ring-1 ring-violet-100" : ""}`}
              >
                <span className={`px-1.5 text-[10px] font-semibold uppercase tracking-wider ${g.group === "Admin" ? "text-violet-500" : "text-slate-400"}`}>
                  {g.group}
                </span>
                {g.links.map((n) => (
                  <Link key={n.href} href={n.href} className="rounded-lg px-2.5 py-1 text-slate-600 hover:bg-white">
                    {n.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-400">{buildLabel()}</span>
            <TestChatToggle tenant={tenant} accent={brand.accent} />
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
              View site
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
