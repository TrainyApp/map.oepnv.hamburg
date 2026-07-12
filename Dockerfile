FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist/map.oepnv.hamburg ./dist/map.oepnv.hamburg

USER node
EXPOSE 4000
CMD ["node", "dist/map.oepnv.hamburg/server/server.mjs"]
