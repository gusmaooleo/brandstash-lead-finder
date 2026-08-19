FROM node:22-alpine

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# packageManager in package.json pins pnpm; pnpm-workspace.yaml approves the
# esbuild build script (required — pnpm 11+ fails the install otherwise).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/status >/dev/null || exit 1
CMD ["pnpm", "start"]
