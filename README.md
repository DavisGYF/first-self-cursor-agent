# AI Copilot Demo（Vue + Express）

这是一个给前端转 AI 开发者准备的最小可运行项目，包含：

- Vue 聊天页面
- Express 后端
- 兼容 OpenAI 的流式接口（SSE）
- 模型切换 + Prompt 模板 + 停止生成
- 历史会话：**浏览器 `localStorage` + 服务端 SQLite（P1）双写**，匿名 `X-Client-Id`
- 左侧 `ChatSidebar`：历史会话 + 知识库文件上传

---

## 历史会话说明

- **本地缓存**：键名如 `ai-copilot-sessions-v1`、`ai-copilot-session-order-v1`；换浏览器仍会丢本地缓存，但**同一浏览器 + 后端在线**时，会话会同步到 `server/data/copilot.db`（`better-sqlite3`）。
- **服务端 API（匿名设备）**：`GET /api/sessions`、`PUT /api/sessions`，请求头必须带 **`X-Client-Id: <UUID>`**（前端自动生成在 `localStorage` 的 `ai-copilot-client-id`）。**无登录**，多设备需自行复制该 UUID（后续可接账号体系）。
- **合并策略（当前）**：启动时若服务端有条目则以**服务端为准**；若服务端空而本地有数据则**上传到服务端**。
- 侧栏会显示「服务端会话：已同步 / 离线」；离线时仍只用本地。
- 侧栏体验：拖动 **⋮⋮** 排序；双击标题或 **名** 重命名（`titleLocked`）；**导出/导入 JSON** 备份。
- 代码：`web/src/sessionSync.js`、`server/db.js`、`server/sessionsStore.js`；侧栏 UI：`web/src/components/ChatSidebar.vue`。

### RAG（P2，已实现一版）

- **分块**：先按空行拆段落，过长再滑窗；短段会合并，减少碎片（见 `server/rag.js`）。
- **检索**：**BM25**（无需 embedding API）；带相对阈值，弱相关片段不注入 system 上下文，降低「硬扯资料」。
- **可调**：`server/.env` 中 `RAG_CHUNK_SIZE`、`RAG_CHUNK_OVERLAP`、`RAG_TOP_K`、`RAG_MIN_RELATIVE_SCORE`。
- **说明**：知识块仍在**内存**，重启后端会清空；向量库/持久化属后续迭代。

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

- RAG：embedding + 向量库、引用质量评估（人工/自动）
- **P3 可观测**：token/成本统计面板（加强 `/api/logs` 前端展示与汇总）— 你提到优先做完 P2 再做
- **会话**：登录用户、多租户、`activeSessionId` 服务端化、冲突合并策略
- 增加工具调用（搜索/数据库查询）
