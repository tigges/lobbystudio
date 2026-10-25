import path from "node:path";
import { loadEnvConfig } from "@next/env";

/** The single .env lives at the repo root, shared with the worker and seed scripts. */
loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production");

/** Lets a single web service do the worker's job on hosts where a separate worker costs extra. */
if (process.env.RUN_SWEEPER === "1") {
  const { startOutcomeSweeper } = await import("@dental-bot/core");
  startOutcomeSweeper((msg) => console.log(`[web] ${msg}`));
}
