# 国内云（腾讯云云托管 / 阿里云容器等）可用此镜像：控制台全在国内，无需访问境外 PaaS
# 构建：docker build -t ai-copilot .
# 运行：docker run -e OPENAI_API_KEY=xxx -p 3000:3000 ai-copilot

FROM node:20-bookworm-slim AS web-build
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
# better-sqlite3 原生模块编译
RUN apt-get update \
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
