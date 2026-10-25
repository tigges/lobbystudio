import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type BuildInfo = { commit: string; builtAt: string | null };

let cached: BuildInfo | null = null;

/** The build being served: written into the image at docker build, else Render's env, else local git. */
export function buildInfo(): BuildInfo {
  if (cached) return cached;
  let baked: { commit?: string; builtAt?: string } = {};
  for (const dir of [process.cwd(), path.join(process.cwd(), ".."), path.join(process.cwd(), "../..")]) {
    const file = path.join(dir, "build-info.json");
    if (!existsSync(file)) continue;
    try {
      baked = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* unreadable; use the fallbacks */
    }
    break;
  }
  const builtAt = baked.builtAt ?? null;
  const commit = [baked.commit, process.env.RENDER_GIT_COMMIT, process.env.GIT_COMMIT].find((c) => c && c !== "unknown");
  if (commit) return (cached = { commit: commit.slice(0, 7), builtAt });
  if (builtAt) return (cached = { commit: "unknown", builtAt });
  try {
    const sha = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return (cached = { commit: `${sha}-dev`, builtAt: null });
  } catch {
    return (cached = { commit: "dev", builtAt: null });
  }
}

export function buildLabel(): string {
  const { commit, builtAt } = buildInfo();
  if (!builtAt) return `Build ${commit}`;
  const when = new Date(builtAt).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Build ${commit} · ${when}`;
}
