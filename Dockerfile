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

# Bake the embedding model and the seed content's passage vectors into the image, so boots never
# depend on the Hugging Face hub and a first boot on a 0.1 CPU instance doesn't embed the whole site.
RUN cd packages/core && node --import tsx src/seed/precompute-embeddings.ts

# Render passes RENDER_GIT_COMMIT to Docker builds; the GHCR workflow passes GIT_COMMIT.
ARG GIT_COMMIT
ARG RENDER_GIT_COMMIT
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "${GIT_COMMIT:-${RENDER_GIT_COMMIT:-unknown}}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build-info.json

RUN pnpm widget:build && NODE_ENV=production pnpm --filter @dental-bot/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "scripts/start-web.sh"]
