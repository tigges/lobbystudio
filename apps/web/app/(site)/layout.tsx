import Link from "next/link";
import Script from "next/script";
import { BusinessSwitcher } from "@/app/business-switcher";
import { brandFor, paletteStyle } from "@/lib/brands";
import { buildLabel } from "@/lib/build";
import { switcherOptions } from "@/lib/business";
import { pageHref, sitePages } from "@/lib/site";
import { NavLinks } from "./nav-links";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { tenant, bundle, pages } = await sitePages();
  const brand = brandFor(tenant);
  const nav = pages.map((p) => ({ href: pageHref(p.slug), label: p.navLabel }));

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip" style={paletteStyle(brand)}>
      <div className="border-b border-slate-200/70 bg-slate-50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-5 py-1.5 text-xs text-slate-500">
          <span>Demo businesses, one assistant platform</span>
          <BusinessSwitcher current={tenant} options={switcherOptions()} />
        </div>
      </div>
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-harbour-600 text-sm font-bold text-white">{brand.initials}</span>
            <span className="leading-tight">
              <span className="block font-semibold text-harbour-900">{bundle.practice.name}</span>
              <span className="block text-xs text-slate-500">{brand.tagline}</span>
            </span>
          </Link>
          <a
            href={`tel:${bundle.practice.phone.replace(/\s/g, "")}`}
            className="rounded-full bg-harbour-50 px-3.5 py-1.5 text-sm font-medium text-harbour-700 ring-1 ring-harbour-100"
          >
            {bundle.practice.phone}
          </a>
          <NavLinks items={nav} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-5xl gap-6 px-5 py-8 text-sm text-slate-600 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-harbour-900">{bundle.practice.name}</p>
            {brand.address.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div>
            <p>{bundle.practice.phone}</p>
            <p>{brand.email}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold">{brand.disclaimerTitle}</p>
            <p>{brand.disclaimer}</p>
          </div>
        </div>
        <p className="mx-auto max-w-5xl px-5 pb-4 text-xs text-slate-400">
          {buildLabel()} · assistant v{bundle.versionNumber} · content v{bundle.contentVersionNumber}
        </p>
      </footer>

      <Script src="/widget.js" data-tenant={tenant} data-accent={brand.accent} strategy="afterInteractive" />
    </div>
  );
}
