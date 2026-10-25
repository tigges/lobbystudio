import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const options = {
  entryPoints: [path.join(here, "src/widget.ts")],
  outfile: path.join(here, "../../apps/web/public/widget.js"),
  bundle: true,
  minify: true,
  sourcemap: true,
  format: "iife",
  target: ["es2020"],
  loader: { ".css": "text" },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
