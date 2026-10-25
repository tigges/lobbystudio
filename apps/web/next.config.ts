import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  transpilePackages: ["@dental-bot/core", "@dental-bot/db"],
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  agentRules: false,
};

export default config;
