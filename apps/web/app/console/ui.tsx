"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TEST_CHAT_KEY = "console:test-chat";

/**
 * Loads the visitor widget into the console so staff can play the visitor and the team side by side.
 * It shares the site's stored conversation, since both are on the same origin.
 */
export function TestChatToggle({ tenant }: { tenant: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(TEST_CHAT_KEY) !== "1") return;
    setOn(true);
    if (document.getElementById("dental-bot-widget") || document.querySelector("script[data-console-widget]")) return;
    const s = document.createElement("script");
    s.src = "/widget.js";
    s.dataset.tenant = tenant;
    s.dataset.accent = "#0f6e6e";
    s.dataset.consoleWidget = "1";
    document.body.appendChild(s);
  }, [tenant]);

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

/** Keeps a server-rendered console page fresh while a visitor is waiting. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
