# Build from the repo root, so the migrations in db/ ship with the server:
#   docker build -f server/Dockerfile -t vocalock-api .
#
# Run:      docker run --env-file server/.env -p 8080:8080 vocalock-api
# Migrate:  docker run --env-file server/.env vocalock-api node dist/migrate.js

FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
# Amazon's RDS root certificates; db.ts verifies the database against them.
COPY server/certs ./certs
# migrate.js reads ../../db/migrations relative to dist/.
COPY db/migrations /app/db/migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
