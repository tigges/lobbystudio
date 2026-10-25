"use client";

import { usePathname } from "next/navigation";

/** Where to land after switching: the same console section, or the site's home page, since slugs and records differ by business. */
function landing(pathname: string) {
  const section = /^\/console(\/(handovers|help|insights|conversations))?/.exec(pathname);
  return section ? section[0] : "/";
}

export function BusinessSwitcher({
  current,
  options,
  tone = "light",
}: {
  current: string;
  options: { id: string; name: string }[];
  tone?: "light" | "console";
}) {
  const back = landing(usePathname());
  return (
    <div
      role="group"
      aria-label="Demo business"
      className={`flex items-center gap-1 rounded-full p-0.5 text-xs ${tone === "console" ? "bg-slate-100" : "bg-white/70 ring-1 ring-slate-200"}`}
    >
      {options.map((o) =>
        o.id === current ? (
          <span key={o.id} aria-current="true" className="rounded-full bg-harbour-600 px-2.5 py-1 font-medium text-white shadow-sm">
            {o.name}
          </span>
        ) : (
          <a
            key={o.id}
            href={`/switch?to=${encodeURIComponent(o.id)}&back=${encodeURIComponent(back)}`}
            className="rounded-full px-2.5 py-1 text-slate-600 hover:bg-white hover:text-slate-900"
          >
            {o.name}
          </a>
        ),
      )}
    </div>
  );
}
