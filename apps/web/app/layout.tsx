import type { Metadata } from "next";
import { businessById } from "@dental-bot/core";
import { brandFor } from "@/lib/brands";
import { currentTenant } from "@/lib/business";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const name = businessById(tenant)?.name ?? "Harbour Dental";
  const brand = brandFor(tenant);
  return {
    title: { default: `${name} · ${brand.disclaimerTitle.toLowerCase()}`, template: `%s · ${name} (demo)` },
    description: brand.description,
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-sand-50 font-sans text-slate-800 antialiased">{children}</body>
    </html>
  );
}
