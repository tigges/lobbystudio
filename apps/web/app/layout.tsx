import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Harbour Dental · demo practice", template: "%s · Harbour Dental (demo)" },
  description: "A fictitious dental practice used to demonstrate the dental-bot assistant.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-sand-50 font-sans text-slate-800 antialiased">{children}</body>
    </html>
  );
}
