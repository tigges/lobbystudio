#!/bin/sh
# Production entrypoint: migrations and the idempotent seed run on every boot, then the site starts.
# next is exec'd directly rather than through pnpm, which would keep a ~90 MB wrapper process alive.
set -e
pnpm --filter @dental-bot/db migrate
pnpm --filter @dental-bot/core seed
cd apps/web
exec ./node_modules/.bin/next start --port "${PORT:-3000}"
