# AI Copilot Demo（Vue + Express）

这是一个给前端转 AI 开发者准备的最小可运行项目，包含：

- Vue 聊天页面
- Express 后端
- 兼容 OpenAI 的流式接口（SSE）
- 模型切换 + Prompt 模板 + 停止生成
- 历史会话（浏览器 `localStorage`，后端不落库）
- 左侧 `ChatSidebar`：历史会话 + 知识库文件上传

---

## 历史会话说明

- 会话列表、消息、系统提示与所选模型会保存在本机浏览器（键名如 `ai-copilot-sessions-v1`）。
- **换浏览器 / 清缓存会丢数据**；若要多端同步或登录用户维度存储，需再接入后端 API + 数据库（当前 `server` 未提供 `/api/sessions`）。
- 侧栏组件：`web/src/components/ChatSidebar.vue`；主逻辑仍在 `web/src/App.vue`。
- 侧栏体验：拖动 **⋮⋮** 调整顺序（`localStorage` 键 `ai-copilot-session-order-v1`）；双击标题或点 **名** 重命名（带 `titleLocked`，不会被自动标题覆盖）；**导出备份 / 导入备份** 为 JSON 文件。

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

看到 `ok: true` 说明后端正常。

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

- RAG 已可上传；可继续做：分块策略优化、向量库、引用质量评估
- 增加 token/成本统计面板（前后端埋点）
- **服务端会话**：REST + SQLite/Postgres（与现有浏览器会话并存或迁移）
- 增加工具调用（搜索/数据库查询）
- 侧栏：会话重命名、拖拽排序、导出/导入 JSON 备份
