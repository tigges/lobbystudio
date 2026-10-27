"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const TEST_CHAT_KEY = "console:test-chat";

/**
 * Loads the visitor widget into the console so staff can play the visitor and the team side by side.
 * It shares the site's stored conversation, since both are on the same origin.
 */
export function TestChatToggle({ tenant, accent }: { tenant: string; accent: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(TEST_CHAT_KEY) !== "1") return;
    setOn(true);
    if (document.getElementById("dental-bot-widget") || document.querySelector("script[data-console-widget]")) return;
    const s = document.createElement("script");
    s.src = "/widget.js";
    s.dataset.tenant = tenant;
    s.dataset.accent = accent;
    s.dataset.consoleWidget = "1";
    document.body.appendChild(s);
  }, [tenant, accent]);

  const toggle = () => {
    if (on) localStorage.removeItem(TEST_CHAT_KEY);
    else localStorage.setItem(TEST_CHAT_KEY, "1");
    // The widget has no teardown, so a reload is the clean way to add or remove it.
    location.reload();
  };

  return (
    <button
      onClick={toggle}
      className={`rounded-lg px-3 py-1.5 text-sm ${on ? "bg-harbour-50 text-harbour-700 ring-1 ring-harbour-100" : "text-slate-600 hover:bg-slate-100"}`}
      title="Show the visitor chat window on console pages"
    >
      {on ? "Hide test chat" : "Test chat"}
    </button>
  );
}

type InboxCounts = { handovers: number; bookings: number };
const INBOX_POLL_MS = 15000;

/**
 * The number of things waiting for the team, on the Inbox link and in the tab title, kept fresh on every console page.
 * With alerts turned on, a browser notification says when something new arrives, even if the tab is in the background.
 */
export function InboxBadge({ initial }: { initial: InboxCounts }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState(initial);
  const last = useRef(initial);
  const total = counts.handovers + counts.bookings;

  useEffect(() => {
    const poll = async () => {
      const res = await fetch("/console/inbox-count", { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const next = (await res.json()) as InboxCounts;
      const prev = last.current;
      last.current = next;
      setCounts(next);
      const lines = [
        next.handovers > prev.handovers && `${next.handovers - prev.handovers} chat${next.handovers - prev.handovers === 1 ? "" : "s"} waiting for a reply`,
        next.bookings > prev.bookings && `${next.bookings - prev.bookings} new booking request${next.bookings - prev.bookings === 1 ? "" : "s"}`,
      ].filter(Boolean);
      if (lines.length && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification("New in the lobbystudio inbox", { body: lines.join(" · "), tag: "inbox" });
        n.onclick = () => {
          window.focus();
          router.push("/console/handovers");
        };
      }
    };
    const t = setInterval(() => void poll(), INBOX_POLL_MS);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    // Each page sets its own title, so the count is put back after navigating.
    const apply = () => {
      const bare = document.title.replace(/^\(\d+\) /, "");
      document.title = total ? `(${total}) ${bare}` : bare;
    };
    apply();
    const t = setTimeout(apply, 100);
    return () => clearTimeout(t);
  }, [total, pathname]);

  return (
    <>
      {total > 0 && (
        <span
          className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-px text-[11px] font-semibold tabular-nums text-white"
          title={`${counts.handovers} waiting for a reply · ${counts.bookings} booking request${counts.bookings === 1 ? "" : "s"} to call back`}
        >
          {total}
        </span>
      )}
    </>
  );
}

/** Asks the browser for permission to show inbox notifications; hidden once answered. */
export function AlertsButton() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => {
    if ("Notification" in window) setPermission(Notification.permission);
  }, []);
  if (permission !== "default") return null;
  return (
    <button
      type="button"
      onClick={() => void Notification.requestPermission().then(setPermission)}
      className="rounded-lg px-3 py-1.5 text-sm text-harbour-700 ring-1 ring-harbour-100 hover:bg-harbour-50"
      title="Get a browser notification when a chat or booking request arrives, while the console is open in a tab"
    >
      Turn on alerts
    </button>
  );
}

/** Keeps a server-rendered console page fresh while a visitor is waiting. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

/** Marks a conversation as a test chat, or back, so the team's lists only show real visitors. */
export function TestChatForm({ conversationId, isTest, action }: { conversationId: string; isTest: boolean; action: (form: FormData) => Promise<void> }) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="test" value={isTest ? "0" : "1"} />
      <button
        className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${isTest ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-500 ring-slate-200 hover:text-slate-800"}`}
        title={isTest ? "This is a test chat, hidden from the lists. Click to show it as a real visitor." : "Hide this chat from the lists as a test"}
      >
        {isTest ? "Test chat · undo" : "Mark as test"}
      </button>
    </form>
  );
}

/** Marks a console page as admin-only, so the practice team knows they can skip it. */
export function AdminNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="mb-4 inline-flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-1.5 text-xs text-violet-800 ring-1 ring-violet-100">
      <span className="font-semibold uppercase tracking-wider">Admin</span>
      <span>{children ?? "For the platform owner. The practice team doesn't need this page."}</span>
    </p>
  );
}

/** Submit button that shows the save is happening and has finished, since the page itself may not visibly change. */
export function SaveButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  const wasPending = useRef(false);
  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [pending]);
  return (
    <button
      disabled={pending}
      className={`rounded-lg px-3 py-1 text-xs font-medium text-white ${saved ? "bg-emerald-600" : "bg-slate-800 hover:bg-slate-900"} disabled:opacity-60`}
    >
      {pending ? "Saving…" : saved ? "Saved ✓" : children}
    </button>
  );
}
