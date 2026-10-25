import { defineConfig } from "drizzle-kit";
import { loadRootEnv } from "./src/env.ts";

loadRootEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
