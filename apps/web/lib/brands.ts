import type { CSSProperties } from "react";

/** How the demo site presents each business. Everything the assistant answers from stays in the seeded pages. */
export type Brand = {
  initials: string;
  tagline: string;
  kicker: string;
  lead: string;
  highlights: string[];
  address: string[];
  email: string;
  /** The widget's accent, and the site's palette in place of the default teal. */
  accent: string;
  palette: { 50: string; 100: string; 600: string; 700: string; 900: string };
  picture: "harbour" | "salon";
  disclaimerTitle: string;
  disclaimer: string;
  description: string;
  teamNote: string;
  /** What the Book page says the chat does. */
  bookingNote: string;
};

const HARBOUR: Brand = {
  initials: "HD",
  tagline: "Rotherhithe · NHS & private",
  kicker: "Family dentist in Rotherhithe",
  lead: "Friendly NHS and private dental care for the whole family, a short walk from Canada Water.",
  highlights: ["New NHS patients under 18 welcome", "Open until 8pm on Tuesdays and Thursdays", "Emergency appointments every weekday", "Step-free access"],
  address: ["14 Quayside Row", "Rotherhithe", "London SE16 4ZZ"],
  email: "hello@harbourdental.example",
  accent: "#0f6e6e",
  palette: { 50: "#f0f7f7", 100: "#d9ecec", 600: "#0f6e6e", 700: "#0b5858", 900: "#0b2b33" },
  picture: "harbour",
  disclaimerTitle: "Demo practice",
  disclaimer:
    "Harbour Dental is fictitious. The address, phone number, staff and prices are invented for a software demo. Nothing here is medical advice.",
  description: "A fictitious dental practice used to demonstrate the dental-bot assistant.",
  teamNote: "The people you'll see when you visit. Our dentists are registered with the General Dental Council.",
  bookingNote: "The assistant takes your details and the team calls you back to confirm.",
};

const MIKAN: Brand = {
  initials: "MH",
  tagline: "Chiswick · cut, colour & care",
  kicker: "Japanese hair salon in Chiswick",
  lead: "Precision cuts, soft lived-in colour and Japanese hair treatments, three minutes from Turnham Green.",
  highlights: ["Open until 8pm Tuesday to Friday", "Free patch tests, no need to book", "Midweek colour days: 20% off", "Walk-ins welcome when we're free"],
  address: ["3 Orchard Mews", "Turnham Green Terrace", "London W4 9ZZ"],
  email: "hello@mikanhair.example",
  accent: "#c2570c",
  palette: { 50: "#fff6ed", 100: "#ffe4c7", 600: "#c2570c", 700: "#9a4309", 900: "#3b1d0a" },
  picture: "salon",
  disclaimerTitle: "Demo salon",
  disclaimer:
    "Mikan Hair Studio is fictitious. The address, phone number, team, prices and diary are invented for a software demo. Nothing here is medical advice.",
  description: "A fictitious hair salon used to demonstrate the assistant booking into a salon diary.",
  teamNote: "The people you'll see when you visit. Prices depend on your stylist's level.",
  bookingNote: "The assistant asks what you'd like, shows you free times and books you in, or the team calls you back.",
};

const BRANDS: Record<string, Brand> = { "harbour-dental": HARBOUR, "mikan-hair": MIKAN };

export function brandFor(tenantId: string): Brand {
  return BRANDS[tenantId] ?? HARBOUR;
}

/** Overrides the theme's `--color-harbour-*` variables, so every harbour utility class takes the business's colours. */
export function paletteStyle(brand: Brand): CSSProperties {
  return Object.fromEntries(Object.entries(brand.palette).map(([k, v]) => [`--color-harbour-${k}`, v])) as CSSProperties;
}
