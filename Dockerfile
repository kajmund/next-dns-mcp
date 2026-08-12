FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV OAUTH_STORE_PATH=/data/oauth-store.json

RUN apk add --no-cache su-exec \
  && addgroup -S mcp && adduser -S mcp -G mcp

COPY --from=build --chown=mcp:mcp /app/package.json /app/package-lock.json* ./
COPY --from=build --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=build --chown=mcp:mcp /app/dist ./dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8080
# Override the Node image ENTRYPOINT. Start as root so we can chown the
# Fly volume, then drop privileges to mcp inside docker-entrypoint.sh.
USER root
ENTRYPOINT ["/app/docker-entrypoint.sh"]
