import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let loaded = false;

export function loadRootEnv() {
  if (loaded) return;
  loaded = true;
  const envPath = path.join(repoRoot, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
