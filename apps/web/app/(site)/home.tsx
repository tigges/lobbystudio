import { HeroActions } from "./chat-buttons";

export type TeamMember = { name: string; role: string };

/** Team members from the "Our team" list in the practice content, so the page and the assistant agree. */
export function teamFromMarkdown(md: string): TeamMember[] {
  const section = /^## Our team\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md)?.[1] ?? "";
  return [...section.matchAll(/^- ([^,\n]+),\s*(.+)$/gm)].map((m) => ({ name: m[1]!.trim(), role: m[2]!.trim() }));
}

/** The home page shows the team as cards, so the plain list is left out of the rendered body. */
export function withoutTeamSection(md: string): string {
  return md.replace(/^## Our team\s*\n[\s\S]*?(?=^## |(?![\s\S]))/m, "");
}

const HIGHLIGHTS = ["New NHS patients under 18 welcome", "Open until 8pm on Tuesdays and Thursdays", "Emergency appointments every weekday", "Step-free access"];

export function Hero({ name, phone }: { name: string; phone: string }) {
  return (
    <section className="relative left-1/2 w-screen -translate-x-1/2 bg-gradient-to-b from-harbour-50 to-white">
      <div className="mx-auto grid max-w-5xl items-center gap-8 px-5 py-12 md:grid-cols-[1.1fr_1fr] md:py-16">
        <div>
          <p className="mb-3 text-sm font-medium uppercase tracking-wider text-harbour-600">Family dentist in Rotherhithe</p>
          <h1 className="text-4xl font-bold tracking-tight text-harbour-900 sm:text-5xl">Welcome to {name}</h1>
          <p className="mt-4 text-lg text-slate-600">
            Friendly NHS and private dental care for the whole family, a short walk from Canada Water.
          </p>
          <HeroActions phone={phone} />
          <ul className="mt-6 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-2">
                <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-harbour-600" aria-hidden>
                  <path fill="currentColor" d="M8.2 13.6 4.6 10l-1.2 1.2 4.8 4.8 9-9-1.2-1.2z" />
                </svg>
                {h}
              </li>
            ))}
          </ul>
        </div>
        <HeroPicture />
      </div>
    </section>
  );
}

/** An illustration rather than a photo: the practice on the riverside. */
function HeroPicture() {
  return (
    <svg viewBox="0 0 480 360" role="img" aria-label="Illustration of the Harbour Dental practice by the river" className="w-full rounded-3xl shadow-sm ring-1 ring-harbour-100">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6f3f3" />
          <stop offset="1" stopColor="#fdf8ef" />
        </linearGradient>
        <linearGradient id="river" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f8f8f" />
          <stop offset="1" stopColor="#0b5858" />
        </linearGradient>
      </defs>
      <rect width="480" height="360" fill="url(#sky)" />
      <circle cx="390" cy="70" r="30" fill="#f6d58e" />
      <path d="M40 92c14-10 32-10 44 0 8-8 26-8 32 4" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" />
      <path d="M300 120c10-7 24-7 32 0 6-6 18-6 22 3" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
      {/* Skyline across the river */}
      <path d="M0 214h40v-30h26v18h30v-44h22v56h34v-26h28v26h40v-14h30v14h48v-38h24v38h40v-22h34v22h84v26H0z" fill="#cfe4e4" />
      {/* Quay */}
      <rect x="0" y="236" width="480" height="18" fill="#d8cbb4" />
      {/* Practice building */}
      <g>
        <rect x="150" y="128" width="180" height="108" rx="6" fill="#ffffff" stroke="#0b2b33" strokeOpacity=".12" />
        <path d="M140 132 240 86l100 46z" fill="#0f6e6e" />
        <rect x="196" y="98" width="88" height="22" rx="11" fill="#ffffff" />
        <path d="M232 103c-4 0-6 3-6 6 0 4 2 9 4 9 1.5 0 1.5-4 3-4s1.5 4 3 4c2 0 4-5 4-9 0-3-2-6-6-6-1 0-1.5.5-1 .5s0-.5-1-.5z" fill="#0f6e6e" />
        <text x="250" y="113.5" fontFamily="system-ui, sans-serif" fontSize="9" fontWeight="700" fill="#0b2b33">
          HARBOUR
        </text>
        {[166, 214, 266].map((x) => (
          <rect key={x} x={x} y="146" width="40" height="30" rx="4" fill="#d9ecec" />
        ))}
        <rect x="166" y="190" width="40" height="30" rx="4" fill="#d9ecec" />
        <rect x="266" y="190" width="40" height="30" rx="4" fill="#d9ecec" />
        <rect x="222" y="188" width="36" height="48" rx="4" fill="#0f6e6e" />
        <circle cx="250" cy="213" r="2" fill="#f6d58e" />
      </g>
      {/* Trees */}
      <circle cx="110" cy="206" r="22" fill="#7fb8a4" />
      <rect x="107" y="214" width="6" height="22" fill="#8a6f52" />
      <circle cx="372" cy="200" r="26" fill="#6aa892" />
      <rect x="369" y="212" width="6" height="24" fill="#8a6f52" />
      {/* River */}
      <rect x="0" y="254" width="480" height="106" fill="url(#river)" />
      {[276, 300, 326].map((y, i) => (
        <path
          key={y}
          d={`M${20 + i * 30} ${y}q15-8 30 0t30 0 30 0`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity=".35"
          strokeWidth="3"
          strokeLinecap="round"
          transform={`translate(${i * 120} 0)`}
        />
      ))}
      {/* Boat */}
      <g transform="translate(320 282)">
        <path d="M0 18h70l-12 14H10z" fill="#ffffff" />
        <rect x="32" y="-18" width="3" height="36" fill="#0b2b33" />
        <path d="M35-16v30h26z" fill="#f6d58e" />
      </g>
    </svg>
  );
}

const AVATAR_TONES = [
  { bg: "#d9ecec", fg: "#0f6e6e" },
  { bg: "#fde9cf", fg: "#a35a12" },
  { bg: "#e5e1f7", fg: "#5b47a8" },
  { bg: "#dcefe0", fg: "#2f7a45" },
];

function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, tone }: { name: string; tone: (typeof AVATAR_TONES)[number] }) {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20" role="img" aria-label={`Portrait placeholder for ${name}`}>
      <circle cx="48" cy="48" r="48" fill={tone.bg} />
      <circle cx="48" cy="38" r="16" fill={tone.fg} fillOpacity=".85" />
      <path d="M18 84c4-16 16-24 30-24s26 8 30 24a48 48 0 0 1-60 0z" fill={tone.fg} fillOpacity=".85" />
      <circle cx="74" cy="74" r="14" fill="#ffffff" />
      <text x="74" y="78.5" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="12" fontWeight="700" fill={tone.fg}>
        {initials(name)}
      </text>
    </svg>
  );
}

export function Team({ members, registered }: { members: TeamMember[]; registered: boolean }) {
  if (members.length === 0) return null;
  return (
    <section id="our-team" className="relative left-1/2 w-screen -translate-x-1/2 scroll-mt-24 border-y border-slate-200/70 bg-white">
      <div className="mx-auto max-w-5xl px-5 py-12">
        <h2 className="text-2xl font-bold tracking-tight text-harbour-900">Meet the team</h2>
        <p className="mt-1 text-slate-600">
          The people you'll see when you visit.{registered ? " Our dentists are registered with the General Dental Council." : ""}
        </p>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {members.map((m, i) => (
            <li key={m.name} className="flex flex-col items-center rounded-2xl bg-slate-50 p-5 text-center ring-1 ring-slate-200/70">
              <Avatar name={m.name} tone={AVATAR_TONES[i % AVATAR_TONES.length]!} />
              <p className="mt-3 font-semibold text-harbour-900">{m.name}</p>
              <p className="text-sm text-slate-600">{m.role.charAt(0).toUpperCase() + m.role.slice(1)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
