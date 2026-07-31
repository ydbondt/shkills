FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install with the full workspace manifest set so the lockfile is respected.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY . .
RUN npm run build

# ---

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
RUN npm ci --omit=dev --workspace=@shkills/server && npm cache clean --force

COPY --from=build /app/packages/server/dist packages/server/dist
# The server serves both of these: the portal, and the CLI the installer fetches.
COPY --from=build /app/packages/web/dist packages/web/dist
COPY --from=build /app/packages/cli/dist packages/cli/dist

ENV SHKILLS_DATA_DIR=/data
VOLUME /data
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
