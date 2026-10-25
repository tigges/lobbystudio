import { execSync, spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (!existsSync(envPath)) {
  copyFileSync(path.join(root, ".env.example"), envPath);
  console.log("[db-up] created .env from .env.example");
}
process.loadEnvFile(envPath);

const url = new URL(process.env.DATABASE_URL ?? "postgres://dental:dental@localhost:5432/dental_bot");
const host = url.hostname;
const port = Number(url.port || 5432);

function reachable() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

if (await reachable()) {
  console.log(`[db-up] postgres reachable at ${host}:${port}`);
  process.exit(0);
}

const hasDocker = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasDocker) {
  console.error(
    `[db-up] nothing is listening on ${host}:${port} and Docker is not installed.\n` +
      "        Start Postgres 16 with pgvector yourself and set DATABASE_URL in .env.",
  );
  process.exit(1);
}

console.log("[db-up] starting postgres with docker compose…");
execSync("docker compose up -d --wait postgres", { cwd: root, stdio: "inherit" });
