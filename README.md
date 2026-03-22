# AI Copilot Demo（Vue + Express）

这是一个给前端转 AI 开发者准备的最小可运行项目，包含：

- Vue 聊天页面
- Express 后端
- 兼容 OpenAI 的流式接口（SSE）
- 模型切换 + Prompt 模板 + 停止生成
- 历史会话：**浏览器 `localStorage` + 服务端 SQLite（P1）双写**，匿名 `X-Client-Id`
- 左侧 `ChatSidebar`：历史会话；**知识库上传**在主区「启用 RAG」一行右侧

---

## 部署上线（公网链接 / 二维码）

思路：**先构建前端**，再**只跑 Node 后端**；若存在 `web/dist`，后端会**同域托管页面**（与 `getApiBase()` 生产环境一致）。

### 国内（推荐：无需科学上网）

**Railway / Render 等境外 PaaS 的官网在国内常不稳定**，若只面向大陆用户，建议：

- **腾讯云 / 阿里云「轻量应用服务器」**：全中文控制台，SSH 上去执行根目录 `npm ci && npm run build`，再用 **PM2** 跑 `npm start`。
- **阿里云 + Docker（推荐多项目）**：**[docs/DEPLOY-ALIYUN-DOCKER.md](./docs/DEPLOY-ALIYUN-DOCKER.md)** — `docker compose up`。
- **阿里云 + 裸机 Node + PM2**：**[docs/DEPLOY-ALIYUN.md](./docs/DEPLOY-ALIYUN.md)** — 与 Docker **二选一**。
- **Docker + 国内云托管**：仓库根目录提供 **`Dockerfile`**，可推到腾讯云容器镜像后在「云托管」里部署（见 [docs/DEPLOY-CN.md](./docs/DEPLOY-CN.md)）。

**费用与通用说明**：**[docs/DEPLOY-CN.md](./docs/DEPLOY-CN.md)**。

**部署命令都是啥意思（备忘）**：**[docs/服务器部署指令DEPLOY-COMMANDS-EXPLAINED.md](./docs/服务器部署指令DEPLOY-COMMANDS-EXPLAINED.md)**。

**本次阿里云从部署到跑通（踩坑：构建慢、DeepSeek 要配 BaseURL）**：[docs/DEPLOY-阿里云部署实录与踩坑.md](./docs/DEPLOY-阿里云部署实录与踩坑.md)。

### 本机试跑「生产形态」

```bash
cd web && npm install && npm run build
cd ../server && npm install && npm start
```

或在**仓库根目录**：`npm install && npm run build && npm start`，浏览器打开 `http://localhost:3000`（页面 + `/api/*` 同一端口）。

### Railway（境外）

若你能稳定访问 [railway.com](https://railway.com)，可用仓库根目录 **`package.json` + `railway.toml`** 一键部署，见 **[docs/RAILWAY.md](./docs/RAILWAY.md)**。

### 自建 VPS（境外或通用）

1. 一台有公网 IP 的 Linux，安装 Node ≥18。
2. 根目录 `npm ci && npm run build`，**PM2** 跑 `npm start`（工作目录为仓库根），放行 **`PORT`**。
3. 环境变量：`OPENAI_API_KEY` 等（从**仓库根目录**启动时，`.env` 放在**根目录**与 `package.json` 同级）。
4. HTTPS：**Nginx / Caddy** 等。

> **注意**：不要把含 Key 的 `.env` 提交到 Git；公网演示建议加访问限制，避免 Key 被盗刷。

---

## 历史会话说明

- **本地缓存**：键名如 `ai-copilot-sessions-v1`、`ai-copilot-session-order-v1`；换浏览器仍会丢本地缓存，但**同一浏览器 + 后端在线**时，会话会同步到 `server/data/copilot.db`（`better-sqlite3`）。
- **服务端 API（匿名设备）**：`GET /api/sessions`、`PUT /api/sessions`，请求头必须带 **`X-Client-Id: <UUID>`**（前端自动生成在 `localStorage` 的 `ai-copilot-client-id`）。**无登录**，多设备需自行复制该 UUID（后续可接账号体系）。
- **合并策略（当前）**：启动时若服务端有条目则以**服务端为准**；若服务端空而本地有数据则**上传到服务端**。
- 侧栏会显示「服务端会话：已同步 / 离线」；离线时仍只用本地。
- 侧栏体验：拖动 **⋮⋮** 排序；双击标题或 **名** 重命名（`titleLocked`）；**导出/导入 JSON** 备份。
- 代码：`web/src/sessionSync.js`、`server/db.js`、`server/sessionsStore.js`；侧栏 UI：`web/src/components/ChatSidebar.vue`。

### RAG（P2 + 持久化 / 可选向量）

- **分块**：先按空行拆段落，过长再滑窗；短段合并（见 `server/rag.js`）。
- **持久化**：文本块写入 **`server/data/copilot.db` 的 `rag_chunks` 表**，重启服务后**自动加载**，上传的文档不会丢（除非删库文件）。
- **检索**：默认 **BM25**（关键词统计）；若设置 **`RAG_EMBEDDING=1`** 且配置了 **`OPENAI_API_KEY`**，上传后会写入 **embedding**，检索时优先用 **语义相似度（余弦）**，失败则回退 BM25。
- **可调**：`RAG_CHUNK_*`、`RAG_TOP_K`、`RAG_MIN_RELATIVE_SCORE`、`RAG_EMBEDDING`、`RAG_EMBEDDING_MODEL`。

### 可观测（P3）

- 主界面 **「查看日志」**：拉取 `GET /api/logs`，含 **汇总**（成功/失败、平均耗时、累计输出 token、粗算 USD、RAG 请求与命中率）与 **明细**（每条请求的估入 token、出 token、成本、RAG 是否命中片段）。
- 输入 token 为 **JSON 长度粗估**，成本为 **示意单价**，非对账精度；面试时说明「可接真实 usage 字段 / 导出到监控」即可。

---

## 1. 先准备环境

- Node.js 版本建议 `>=18`
- 你自己的大模型 API Key

---

## 2. 启动后端

```bash
cd server
cp .env.example .env
```

然后打开 `server/.env`，把 `OPENAI_API_KEY` 改成你的 key。

再安装并启动：

```bash
npm install
npm run dev
```

后端启动后，访问：

- `http://localhost:3000/api/health`

看到 `ok: true` 且 `hasSessionsApi: true` 说明后端正常（含会话接口）。

---

## 3. 启动前端

新开一个终端：

```bash
cd web
npm install
npm run dev
```

打开浏览器访问：

- `http://localhost:5173`

---

## 4. 你可以立刻改的地方

- 修改默认模型：`server/.env` 里的 `DEFAULT_MODEL`
- 修改模型下拉：`web/src/App.vue` 里的 `models`
- 修改 Prompt 模板：`web/src/App.vue` 里的 `promptTemplates`
- 调整侧栏 UI：`web/src/components/ChatSidebar.vue` + `web/src/style.css`
- 修改后端转发地址：`server/.env` 里的 `OPENAI_BASE_URL`

---

## 5. 常见问题

1) 提示 `Missing OPENAI_API_KEY`
- 没有在 `server/.env` 配置 key。

2) 前端请求失败
- 先确认后端在 `3000` 端口运行。
- 再看 key、model、baseURL 是否正确。

3) 没有流式输出
- 某些模型或网关对 stream 支持不同，可先换官方兼容模型测试。

---

## 6. 下一步建议（你半个月版本）

- RAG：引用质量评估（人工/自动）、多文档权限
- **会话**：登录用户、多租户、`activeSessionId` 服务端化、冲突合并策略
- 增加工具调用（搜索/数据库查询）
