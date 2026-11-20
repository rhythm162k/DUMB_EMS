FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

COPY apps/api ./apps/api
RUN npm run build --workspace=@ems/api
RUN npm prune --omit=dev

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Private photo folder; a named volume mounted here inherits this ownership on first use.
RUN mkdir -p /app/storage/profile-images && chown -R node:node /app/storage

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
