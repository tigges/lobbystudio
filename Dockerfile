FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/widget/package.json packages/widget/
RUN pnpm install --frozen-lockfile

COPY . .

# Bake the embedding model into the image so boots never depend on the Hugging Face hub.
RUN cd packages/core && pnpm exec tsx -e "import('./src/retrieval/embed.ts').then((m) => m.embed(['warm-up'], 'query'))"

RUN pnpm widget:build && NODE_ENV=production pnpm --filter @dental-bot/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "scripts/start-web.sh"]
