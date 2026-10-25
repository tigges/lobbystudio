import path from "node:path";
import { loadEnvConfig } from "@next/env";

/** The single .env lives at the repo root, shared with the worker and seed scripts. */
loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production");
