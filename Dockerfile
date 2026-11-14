FROM oven/bun:1.4.4 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS development
COPY --chown=bun:bun . .
ENV NODE_ENV=development
USER bun
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM development AS build
RUN bun run check && bun run test && bun run build

FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=bun:bun /app/apps/web/dist ./
USER bun
EXPOSE 3000
CMD ["bun", "index.js"]
