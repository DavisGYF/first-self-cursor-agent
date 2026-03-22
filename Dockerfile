# 国内云（腾讯云云托管 / 阿里云 ECS 等）
# 构建：docker build -t ai-copilot .
# 国内默认：Debian 走阿里云 apt 镜像、npm 走 npmmirror（海外可加参数关闭）
#
# 海外构建示例：
#   docker build --build-arg USE_CN_APT=false --build-arg NPM_REGISTRY=https://registry.npmjs.org -t ai-copilot .

FROM node:20-bookworm-slim AS web-build
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runner
ARG USE_CN_APT=true
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
WORKDIR /app
# better-sqlite3 编译依赖；apt 默认走境外较慢，国内替换为 mirrors.aliyun.com
RUN if [ "$USE_CN_APT" = "true" ]; then \
  set -e; \
  for f in /etc/apt/sources.list.d/*.sources /etc/apt/sources.list; do \
    [ -f "$f" ] || continue; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' "$f"; \
    sed -i 's|security.debian.org|mirrors.aliyun.com|g' "$f"; \
  done; \
  fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=web-build /src/dist ./web/dist
ENV NODE_ENV=production
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "index.js"]
