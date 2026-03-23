FROM node:24-alpine AS deps
WORKDIR /app

# Build tools for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/proxy/package.json ./packages/proxy/

# Install proxy dependencies (production + tsx runtime)
RUN npm install --workspace=packages/proxy

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/proxy/node_modules ./packages/proxy/node_modules
COPY packages/proxy ./packages/proxy
COPY package.json ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/guard.db

VOLUME ["/data"]

CMD ["node", "--import", "tsx/esm", "packages/proxy/src/index.ts"]
