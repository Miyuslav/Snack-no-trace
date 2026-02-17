# syntax = docker/dockerfile:1
ARG NODE_VERSION=20.20.0
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app
ENV NODE_ENV=production

# ---- deps stage（依存だけ）----
FROM base AS deps
COPY package*.json ./
# lockfile があるなら npm ci、無ければ npm install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- final ----
FROM base
COPY --from=deps /app/node_modules /app/node_modules
COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
