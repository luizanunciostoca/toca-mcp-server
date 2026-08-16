FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y imagemagick && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "dist/src/http.js"]
