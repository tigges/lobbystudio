"use client";

declare global {
  interface Window {
    DentalBot?: { open: (opts?: { action?: "book" }) => void };
  }
}

export function ChatButtons() {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl bg-harbour-50 p-4 ring-1 ring-harbour-100">
      <button
        type="button"
        onClick={() => window.DentalBot?.open({ action: "book" })}
        className="rounded-full bg-harbour-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-harbour-700"
      >
        Book a check-up in the chat
      </button>
      <span className="text-sm text-slate-600">The assistant takes your details and the team calls you back to confirm.</span>
    </div>
  );
}
