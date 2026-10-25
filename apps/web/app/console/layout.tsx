import Link from "next/link";
import { buildLabel } from "@/lib/build";
import { SITE_TENANT } from "@/lib/site";
import { TestChatToggle } from "./ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Console" };

const NAV = [
  { href: "/console/handovers", label: "Handovers" },
  { href: "/console/conversations", label: "Conversations" },
  { href: "/console/help", label: "Help" },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
          <Link href="/console" className="font-semibold text-harbour-900">
            dental-bot <span className="font-normal text-slate-400">console</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-400">{buildLabel()}</span>
            <TestChatToggle tenant={SITE_TENANT} />
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
