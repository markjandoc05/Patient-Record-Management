FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run lint && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STORAGE_DIR=/app/data/files
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
RUN mkdir -p /app/data/files && chown -R node:node /app/data
USER node
EXPOSE 8080
CMD ["sh", "-c", "node dist/migrate.cjs && exec node dist/server.cjs"]
