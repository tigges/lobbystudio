#!/bin/sh
set -e
cd apps/worker
exec node --import tsx src/index.ts
