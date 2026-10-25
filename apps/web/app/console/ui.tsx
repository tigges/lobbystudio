"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps a server-rendered console page fresh while a visitor is waiting. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
