"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex w-full flex-wrap gap-1 text-sm">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-2.5 py-1.5 ${active ? "bg-harbour-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
