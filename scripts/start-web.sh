#!/bin/sh
# Production entrypoint: migrations and the idempotent seed run on every boot, then the site starts.
# Everything is exec'd with node directly: pnpm wrappers cost ~90 MB each, which a 512 MB instance can't spare.
set -e
(cd packages/db && node --import tsx src/migrate.ts)
(cd packages/core && node --import tsx src/seed/seed.ts)
cd apps/web
exec ./node_modules/.bin/next start --port "${PORT:-3000}"
