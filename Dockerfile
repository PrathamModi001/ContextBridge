# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/server/package.json ./packages/server/

RUN npm ci --workspace=packages/server

COPY packages/server/tsconfig.json ./packages/server/
COPY packages/server/src ./packages/server/src

RUN npm run build --workspace=packages/server

# Stage 2: production
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/server/package.json ./packages/server/

RUN npm ci --workspace=packages/server --omit=dev

COPY --from=builder /app/packages/server/dist ./packages/server/dist

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/v1/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
