"use client";

declare global {
  interface Window {
    DentalBot?: { open: (opts?: { action?: "book" }) => void };
  }
}

export function ChatButtons({ note }: { note: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl bg-harbour-50 p-4 ring-1 ring-harbour-100">
      <button
        type="button"
        onClick={() => window.DentalBot?.open({ action: "book" })}
        className="rounded-full bg-harbour-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-harbour-700"
      >
        Book an appointment in the chat
      </button>
      <span className="text-sm text-slate-600">{note}</span>
    </div>
  );
}

export function HeroActions({ phone }: { phone: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => window.DentalBot?.open({ action: "book" })}
        className="rounded-full bg-harbour-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-harbour-700"
      >
        Book an appointment
      </button>
      <a
        href={`tel:${phone.replace(/\s/g, "")}`}
        className="rounded-full bg-white px-5 py-2.5 font-medium text-harbour-700 ring-1 ring-harbour-100 hover:bg-harbour-50"
      >
        Call {phone}
      </a>
      <button type="button" onClick={() => window.DentalBot?.open()} className="text-sm font-medium text-harbour-700 hover:underline">
        Or ask our assistant
      </button>
    </div>
  );
}
