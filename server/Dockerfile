# 빌드 컨텍스트는 저장소 루트다: docker build -f server/Dockerfile -t relay-api .
# 1단계: 워크스페이스 전체를 설치하고 core·server를 빌드한다.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY server/package.json server/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages/core packages/core
COPY server server
RUN npm run build -w @relay/core && npm run build -w @relay/server && npm prune --omit=dev --ignore-scripts

# 2단계: 실행에 필요한 것만 담는다. @relay/core는 node_modules의 링크가 packages/core/dist를 가리킨다.
FROM node:22-alpine
ENV NODE_ENV=production
ARG RELAY_BUILD=dev
ENV RELAY_BUILD=$RELAY_BUILD
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/core/package.json packages/core/package.json
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/server/package.json server/package.json
COPY --from=build /repo/server/dist server/dist
COPY --from=build /repo/server/drizzle server/drizzle
RUN mkdir -p /data/files && chown -R node:node /data
USER node
WORKDIR /repo/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
