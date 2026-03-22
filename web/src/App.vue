<template>
  <div class="app-layout">
    <ChatSidebar
      :sessions="displaySessions"
      :active-session-id="activeSessionId"
      :is-generating="isGenerating"
      :server-sync-hint="serverSyncHint"
      @create-session="createNewSession"
      @switch-session="switchSession"
      @delete-session="deleteSession"
      @rename-session="onRenameSession"
      @reorder-sessions="reorderSessions"
      @export-backup="exportSessionsBackup"
      @import-backup="importSessionsBackup"
    />

    <div class="main-column">
      <el-card class="panel-card" shadow="hover">
        <template #header>
          <div class="card-header-row">
            <span class="title">介助cursor搭建全栈示例（Vue + Express）</span>
          </div>
        </template>

        <div class="panel-stack">
          <div class="panel-top-group">
          <!-- 区块 1：说明 -->
          <section class="panel-section panel-section--intro" aria-label="功能说明">
            <el-text class="subtitle-block" type="info">
              功能概览：多模型对话、SSE 流式输出、会话管理（本地缓存 + 服务端同步）、知识库 RAG（段落分块 / BM25
              或可选向量）、引用来源展示、请求监控与成本估算。
            </el-text>
            <el-text size="small" type="info" class="subtitle-block subtitle-tight panel-intro-sub">
              开发环境下流式请求直连后端
              <code class="inline-code">localhost:3000</code>
              ，避免 Vite 代理缓冲 SSE。健康检查：
              <el-link href="http://localhost:3000/api/health" target="_blank" type="primary">/api/health</el-link>
              （<code class="inline-code">startedAt</code> 随进程重启变化）。
            </el-text>
          </section>

          <!-- 区块 2：模型与提示词（三项表单一体） -->
          <section class="panel-section panel-section--settings" aria-label="模型与提示词">
            <el-form label-position="left" label-width="100px" class="settings-form">
              <el-row :gutter="16" class="settings-form-row">
                <el-col :xs="24" :sm="12">
                  <el-form-item label="大模型">
                    <el-select
                      v-model="selectedModel"
                      placeholder="选择要调用的模型"
                      filterable
                      class="settings-form-control"
                    >
                      <el-option v-for="model in models" :key="model" :label="model" :value="model" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="场景模板">
                    <el-select
                      v-model="templatePickerValue"
                      placeholder="选预设场景，一键填入下方系统提示词"
                      class="settings-form-control"
                      @change="applyTemplate"
                    >
                      <el-option
                        v-for="item in promptTemplates"
                        :key="item.label"
                        :label="item.label"
                        :value="item.value"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-form-item label="系统提示词" class="settings-form-item--textarea">
                <el-input
                  v-model="systemPrompt"
                  type="textarea"
                  :rows="3"
                  placeholder="告诉模型扮演什么角色、用什么语气与格式回答"
                  resize="vertical"
                  class="settings-form-control"
                />
              </el-form-item>
            </el-form>
          </section>
          </div>

          <!-- 区块 3：对话与操作（含监控等） -->
          <section class="panel-section panel-section--conversation" aria-label="对话与操作">
            <div class="conversation-layout">
              <div class="rag-toolbar-row">
                <el-checkbox v-model="useRag" class="rag-toolbar-checkbox">启用 RAG（让回答参考你上传的文档）</el-checkbox>
                <div class="rag-kb-column">
                  <div class="rag-kb-inline" aria-label="知识库文件">
                    <div class="rag-kb-inline-main">
                      <span class="rag-kb-label">知识库文件</span>
                      <div class="rag-kb-controls">
                        <el-upload
                          class="rag-kb-upload"
                          :auto-upload="false"
                          :show-file-list="false"
                          accept=".txt,.md,text/plain,text/markdown"
                          @change="onRagUploadChange"
                        >
                          <template #trigger>
                            <el-button type="primary" plain size="small">选择文件</el-button>
                          </template>
                        </el-upload>
                        <el-button
                          type="primary"
                          size="small"
                          :disabled="!hasSelectedRagFile || uploadingFile"
                          :loading="uploadingFile"
                          @click="uploadRagFile"
                        >
                          {{ uploadingFile ? "上传中..." : "上传知识库文件" }}
                        </el-button>
                      </div>
                    </div>
                    <div v-if="selectedFileName || ragStatusText" class="rag-kb-meta">
                      <span v-if="selectedFileName" class="rag-kb-file-name" :title="selectedFileName">
                        已选：{{ selectedFileName }}
                      </span>
                      <el-text v-if="ragStatusText" size="small" type="primary" class="rag-kb-status" tag="span">
                        {{ ragStatusText }}
                      </el-text>
                    </div>
                  </div>
                  <p class="rag-kb-hint">
                    上传 .txt / .md 至后端知识库（持久化存储），勾选「启用 RAG」后参与检索。
                  </p>
                </div>
              </div>

              <el-alert v-if="ragMatchHint" :title="ragMatchHint" type="info" show-icon :closable="false" />

              <!-- 对话区：固定高度，仅框内滚动，不挤占下方输入/按钮 -->
              <div class="chat-messages-fullbleed conversation-messages-grow">
                <el-scrollbar class="messages-scrollbar messages-scrollbar-fill">
                  <div class="messages messages-inner">
                    <div
                      v-for="(msg, idx) in messages"
                      :key="idx"
                      class="msg"
                      :class="msg.role === 'user' ? 'msg-user' : 'msg-assistant'"
                    >
                      <strong>{{ msg.role === "user" ? "你：" : "AI：" }}</strong>{{ msg.content }}
                      <div v-if="msg.role === 'assistant' && msg.sources?.length" class="source-box">
                        <div class="source-title">引用来源：</div>
                        <div v-for="source in msg.sources" :key="source.id" class="source-item">
                          <strong>{{ source.title }} #{{ source.chunkIndex }}</strong>
                          <span v-if="source.score != null" class="source-score"
                            >（相关度 {{ source.score.toFixed(4) }}）</span
                          >
                          <strong>：</strong>{{ source.text }}
                        </div>
                      </div>
                    </div>
                  </div>
                </el-scrollbar>
              </div>

              <!-- 无消息时也占满中间区域，本块始终贴对话区最底部一行 -->
              <div class="conversation-footer">
                <el-input
                  v-model="inputText"
                  placeholder="输入你的问题，回车发送"
                  clearable
                  @keyup.enter="sendMessage"
                />

                <el-space wrap :size="8" class="conversation-actions">
                  <el-button type="primary" :disabled="isGenerating" @click="sendMessage">发送</el-button>
                  <el-button :disabled="!isGenerating" @click="stopGenerating">停止生成</el-button>
                  <el-button :disabled="isGenerating" @click="runStreamDemo">流式测试</el-button>
                  <el-button @click="toggleLogPanel">{{ showLogPanel ? "收起监控" : "请求监控" }}</el-button>
                  <el-checkbox v-model="showStreamDebug" border>显示流式调试（页面 + 浏览器控制台 F12）</el-checkbox>
                </el-space>
              </div>
            </div>

            <el-card v-if="showStreamDebug" shadow="never" class="stream-debug-card">
              <template #header>
                <span class="source-title">流式调试（最新在上）</span>
              </template>
              <pre class="stream-debug-pre">{{ streamDebugText }}</pre>
              <el-button size="small" @click="clearStreamDebug">清空</el-button>
            </el-card>

            <el-card v-if="showLogPanel" shadow="never" class="obs-card-wrap">
              <template #header>
                <div class="obs-header-row">
                  <span class="source-title">请求监控（进程内缓存，服务重启后清空）</span>
                  <el-button size="small" type="primary" plain @click="fetchLogs">刷新</el-button>
                </div>
              </template>
              <p class="obs-pitch">
                <strong>功能说明：</strong>后端在每次对话流结束后写入结构化记录；此处展示汇总指标与最近明细，包括成功率、耗时、输出
                token 量、按公开价目粗算的费用，以及开启 RAG
                时是否命中知识片段。输入 token 由请求体长度估算，费用为示意值，适用于演示、排障与容量感知，不等同于账单对账。
              </p>

              <div v-if="logsSummary" class="obs-summary-grid">
                <el-card v-for="(cell, i) in obsSummaryCells" :key="i" shadow="never" class="obs-stat-card">
                  <div class="obs-card-k">{{ cell.k }}</div>
                  <div class="obs-card-v">{{ cell.v }}</div>
                </el-card>
              </div>

              <el-divider content-position="left">最近明细（新在上）</el-divider>
              <div v-if="logs.length === 0" class="source-item">暂无记录，发几条消息后点刷新</div>
              <div
                v-for="(log, idx) in logs"
                :key="idx"
                class="source-item obs-log-row"
                :class="{ 'obs-log-err': !!log.error }"
              >
                <span class="obs-log-time">{{ log.time?.slice(11, 19) }}</span>
                <span class="obs-log-ok">{{ log.error ? "✗" : "✓" }}</span>
                {{ log.elapsed }}ms
                · 出 {{ log.outputTokens }} tok
                · 估入 ~{{ log.estimatedPromptTokens ?? "—" }} tok
                · ~${{ log.estimatedCostUsd ?? "—" }}
                · {{ log.model }}
                <span v-if="log.useRag" class="obs-rag">
                  [RAG{{ log.ragMatched ? "·命中" + log.ragHitCount + "段" : "·未命中" }}]
                </span>
                <div v-if="log.error" class="obs-err-text">错误: {{ log.error }}</div>
              </div>
            </el-card>
          </section>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadFile } from "element-plus";
import ChatSidebar from "./components/ChatSidebar.vue";
import type {
  ChatLogEntry,
  ChatMessage,
  LogsApiResponse,
  LogsSummary,
  PromptTemplate,
  RagSource,
  ServerSyncStatus,
  SessionRecord,
  SessionsBackupPayload,
  SseDataLine
} from "./types";
import { getApiBase } from "./apiBase";
import { fetchServerSessions, putServerSessions } from "./sessionSync";

// 流式请求仍直连后端 3000，见 apiBase.ts

// 预置几个模型名称，你可以按自己 key 支持的模型改
const models = ["gpt-4o-mini", "deepseek-chat", "qwen-plus"] as const;

// 预置 Prompt 模板，方便你快速切换业务场景
const promptTemplates: PromptTemplate[] = [
  { label: "通用助手", value: "你是一个专业、简洁、可靠的中文 AI 助手。" },
  { label: "短视频脚本", value: "你是短视频编导，请按钩子-正文-结尾行动号召输出。" },
  { label: "SEO 写作", value: "你是 SEO 编辑，请输出结构化内容并兼顾可读性与关键词。" },
  { label: "客服助手", value: "你是客服专员，语气礼貌，先共情再给解决方案。" }
];

// 消息列表，角色分为 user / assistant
const messages = ref<ChatMessage[]>([]);

// 当前输入框内容
const inputText = ref("");

// 当前选择模型
const selectedModel = ref<string>(models[0]);

// 当前系统提示词
const systemPrompt = ref(promptTemplates[0].value);

/** 与「快速选择 Prompt 模板」下拉同步（仅 UI，切换会话时不必与 systemPrompt 严格一致） */
const templatePickerValue = ref(promptTemplates[0].value);

// 标记当前是否正在生成中
const isGenerating = ref(false);

// 是否启用 RAG 检索增强
const useRag = ref(false);

// 上传文件相关状态
const selectedFile = ref<File | null>(null);
const uploadingFile = ref(false);
const ragStatusText = ref("");
const ragMatchHint = ref("");

// =========================
// 历史会话（仅浏览器 localStorage，不落库、不调后端）
// 每条：{ id, title, messages, updatedAt, systemPrompt?, selectedModel? }
// =========================
const SESSIONS_STORAGE_KEY = "ai-copilot-sessions-v1";
const ACTIVE_SESSION_STORAGE_KEY = "ai-copilot-active-session-v1";
/** 侧栏展示顺序（仅 id 列表，与 sessions 数组顺序无关） */
const SESSION_ORDER_STORAGE_KEY = "ai-copilot-session-order-v1";

const sessions = ref<SessionRecord[]>([]);
const activeSessionId = ref("");
const sessionSidebarOrder = ref<string[]>([]);

/** P1：与服务端 SQLite 同步状态（仅展示） */
const serverSyncStatus = ref<ServerSyncStatus>("idle");

const serverSyncHint = computed(() => {
  switch (serverSyncStatus.value) {
    case "loading":
      return "服务端会话：同步中…";
    case "synced":
      return "服务端会话：已同步（SQLite）";
    case "offline":
      return "服务端会话：离线（仅本地，请确认后端 3000 已启动）";
    case "error":
      return "服务端会话：同步异常";
    default:
      return "";
  }
});

// 按 sessionSidebarOrder 排会话；顺序里没有的 id 会按 updatedAt 降序补在末尾
const displaySessions = computed(() => {
  const byId = new Map(sessions.value.map((s) => [s.id, s]));
  const ordered = [];
  const seen = new Set();
  for (const id of sessionSidebarOrder.value) {
    const s = byId.get(id);
    if (s) {
      ordered.push(s);
      seen.add(id);
    }
  }
  const rest = sessions.value
    .filter((s) => !seen.has(s.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return [...ordered, ...rest];
});

// 主区展示用：当前选中的本地文件名（实际上传逻辑仍在下方 onFileChange / uploadRagFile）
const selectedFileName = computed(() => selectedFile.value?.name?.trim() || "");
const hasSelectedRagFile = computed(() => !!selectedFileName.value?.trim());

function generateSessionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// 从 localStorage 读出会话数组（失败则保持空数组）
function loadSessionsFromStorage() {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      sessions.value = parsed;
    }
  } catch (e) {
    console.warn("[会话] 读取 localStorage 失败", e);
  }
}

function loadSessionOrderFromStorage() {
  try {
    const raw = localStorage.getItem(SESSION_ORDER_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      sessionSidebarOrder.value = parsed.filter((id) => typeof id === "string");
    }
  } catch (e) {
    console.warn("[会话顺序] 读取 localStorage 失败", e);
  }
}

// 保证顺序里的 id 都存在，且新会话 id 会出现在列表中
function ensureSessionOrderConsistency() {
  const ids = new Set(sessions.value.map((s) => s.id));
  let order = sessionSidebarOrder.value.filter((id) => ids.has(id));
  const missing = sessions.value.filter((s) => !order.includes(s.id));
  missing.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  order = [...order, ...missing.map((s) => s.id)];
  sessionSidebarOrder.value = order;
}

// 把整个 sessions + 侧栏顺序 + 当前选中 id 写回本地；可选跳过服务端防抖上传
function saveSessionsToStorage(options: { skipServer?: boolean } = {}) {
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions.value));
    localStorage.setItem(SESSION_ORDER_STORAGE_KEY, JSON.stringify(sessionSidebarOrder.value));
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId.value);
  } catch (e) {
    console.warn("[会话] 写入 localStorage 失败（可能超出配额）", e);
  }
  if (!options.skipServer) {
    scheduleServerSync();
  }
}

let serverSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleServerSync() {
  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(() => {
    serverSyncTimer = null;
    pushSessionsToServer();
  }, 650);
}

function normalizeServerSession(s: Partial<SessionRecord> & { id: string }): SessionRecord {
  const rawMessages = Array.isArray(s.messages) ? s.messages : [];
  return {
    id: s.id,
    title: s.title || "新会话",
    titleLocked: !!s.titleLocked,
    messages: rawMessages as ChatMessage[],
    updatedAt: Number(s.updatedAt) || Date.now(),
    systemPrompt: s.systemPrompt,
    selectedModel: s.selectedModel
  };
}

async function pushSessionsToServer() {
  if (sessions.value.length === 0) return;
  try {
    await putServerSessions({
      sessions: JSON.parse(JSON.stringify(sessions.value)),
      sessionOrder: [...sessionSidebarOrder.value]
    });
    serverSyncStatus.value = "synced";
  } catch (e) {
    console.warn("[服务端会话] 上传失败", e);
    serverSyncStatus.value = "offline";
  }
}

async function hydrateFromServer() {
  serverSyncStatus.value = "loading";
  try {
    const data = await fetchServerSessions();
    const serverSessions = data.sessions;
    if (serverSessions && serverSessions.length > 0) {
      sessions.value = serverSessions.map(normalizeServerSession);
      sessionSidebarOrder.value = Array.isArray(data.sessionOrder)
        ? data.sessionOrder.filter((id) => typeof id === "string")
        : [];
      ensureSessionOrderConsistency();
      const savedActive = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      const exists =
        savedActive && sessions.value.some((s) => s.id === savedActive);
      activeSessionId.value = exists ? savedActive : sessions.value[0].id;
      applySessionToUI(activeSessionId.value);
      saveSessionsToStorage({ skipServer: true });
      serverSyncStatus.value = "synced";
      return;
    }
    serverSyncStatus.value = "synced";
  } catch (e) {
    console.warn("[服务端会话] GET 失败，使用本地数据", e);
    serverSyncStatus.value = "offline";
  }

  if (sessions.value.length === 0) {
    const id = generateSessionId();
    sessions.value = [
      {
        id,
        title: "新会话",
        titleLocked: false,
        messages: [],
        updatedAt: Date.now(),
        systemPrompt: promptTemplates[0].value,
        selectedModel: models[0]
      }
    ];
    sessionSidebarOrder.value = [id];
    activeSessionId.value = id;
    applySessionToUI(id);
    saveSessionsToStorage({ skipServer: false });
    return;
  }

  ensureSessionOrderConsistency();
  const savedActive = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  const exists = savedActive && sessions.value.some((s) => s.id === savedActive);
  activeSessionId.value = exists ? savedActive : sessions.value[0].id;
  applySessionToUI(activeSessionId.value);

  try {
    await pushSessionsToServer();
    serverSyncStatus.value = "synced";
  } catch {
    serverSyncStatus.value = "offline";
  }
}

// 把当前界面上的 messages / 系统提示 / 模型写回「当前会话」那条记录
function persistCurrentSession() {
  const id = activeSessionId.value;
  if (!id) return;
  const idx = sessions.value.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const firstUser = messages.value.find((m) => m.role === "user");
  const autoTitle = (firstUser?.content || "").trim().slice(0, 28) || "新会话";
  const prev = sessions.value[idx];
  // 用户手动改过标题则不再用首条用户消息覆盖
  const title = prev.titleLocked ? prev.title : autoTitle;
  sessions.value[idx] = {
    ...sessions.value[idx],
    messages: JSON.parse(JSON.stringify(messages.value)),
    title,
    updatedAt: Date.now(),
    systemPrompt: systemPrompt.value,
    selectedModel: selectedModel.value
  };
  saveSessionsToStorage();
}

// 根据会话 id 把数据灌回界面（切换会话时调用）
function applySessionToUI(sessionId: string) {
  const s = sessions.value.find((x) => x.id === sessionId);
  if (!s) return;
  messages.value = JSON.parse(JSON.stringify(s.messages || []));
  systemPrompt.value = s.systemPrompt ?? promptTemplates[0].value;
  selectedModel.value =
    s.selectedModel && (models as readonly string[]).includes(s.selectedModel)
      ? s.selectedModel
      : models[0];
  ragMatchHint.value = "";
}

// 新建一条空会话，并切过去（先保存当前会话内容）
function createNewSession() {
  if (isGenerating.value) return;
  persistCurrentSession();
  const id = generateSessionId();
  sessions.value.unshift({
    id,
    title: "新会话",
    titleLocked: false,
    messages: [],
    updatedAt: Date.now(),
    systemPrompt: systemPrompt.value,
    selectedModel: selectedModel.value
  });
  sessionSidebarOrder.value = [id, ...sessionSidebarOrder.value.filter((x) => x !== id)];
  activeSessionId.value = id;
  messages.value = [];
  ragMatchHint.value = "";
  ragStatusText.value = "";
  saveSessionsToStorage();
}

// 点击左侧某条会话：先落盘当前，再切换
function switchSession(id: string) {
  if (id === activeSessionId.value || isGenerating.value) return;
  persistCurrentSession();
  activeSessionId.value = id;
  applySessionToUI(id);
  saveSessionsToStorage();
}

// 删除一条会话；至少保留一条
function deleteSession(id: string) {
  if (sessions.value.length <= 1) {
    ElMessage.warning("至少保留一个会话");
    return;
  }
  const idx = sessions.value.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sessions.value.splice(idx, 1);
  sessionSidebarOrder.value = sessionSidebarOrder.value.filter((x) => x !== id);
  if (activeSessionId.value === id) {
    activeSessionId.value = sessions.value[0].id;
    applySessionToUI(activeSessionId.value);
  }
  saveSessionsToStorage();
}

// 侧栏重命名：锁定标题，避免随后 persist 用首条用户消息顶掉
function onRenameSession({ id, title }: { id: string; title: string }) {
  const t = String(title || "").trim().slice(0, 60) || "新会话";
  const idx = sessions.value.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sessions.value[idx] = {
    ...sessions.value[idx],
    title: t,
    titleLocked: true,
    updatedAt: Date.now()
  };
  saveSessionsToStorage();
}

// 拖拽后的 id 顺序（由 ChatSidebar 根据当前展示列表算出）
function reorderSessions(newOrderIds: string[]) {
  const set = new Set(sessions.value.map((s) => s.id));
  const valid = newOrderIds.filter((id) => set.has(id));
  for (const s of sessions.value) {
    if (!valid.includes(s.id)) valid.push(s.id);
  }
  sessionSidebarOrder.value = valid;
  saveSessionsToStorage();
}

// 导出 JSON 备份（可拷到另一台电脑或留档）
function exportSessionsBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: sessions.value,
    sessionOrder: sessionSidebarOrder.value,
    activeSessionId: activeSessionId.value
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ai-copilot-sessions-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 从备份文件恢复（会替换当前浏览器里的会话数据）
async function importSessionsBackup(file: File | undefined) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text) as SessionsBackupPayload;
    if (!Array.isArray(data.sessions) || data.sessions.length === 0) {
      ElMessage.error("文件里没有有效的 sessions 数组");
      return;
    }
    await ElMessageBox.confirm("将用备份替换当前所有会话与顺序，确定吗？", "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning"
    });
    sessions.value = data.sessions;
    sessionSidebarOrder.value = Array.isArray(data.sessionOrder)
      ? data.sessionOrder.filter((id) => typeof id === "string")
      : [];
    ensureSessionOrderConsistency();
    const aid = data.activeSessionId;
    const exists = aid && sessions.value.some((s) => s.id === aid);
    activeSessionId.value = exists ? aid : sessions.value[0].id;
    applySessionToUI(activeSessionId.value);
    saveSessionsToStorage();
    await pushSessionsToServer();
  } catch (e: unknown) {
    if (e === "cancel" || e === "close") return;
    console.warn("[导入备份] 失败", e);
    ElMessage.error(`导入失败：${String(e)}`);
  }
}

// 页面首次加载：先读本地缓存，再与服务端 SQLite 对齐（P1）
onMounted(async () => {
  loadSessionsFromStorage();
  loadSessionOrderFromStorage();
  await hydrateFromServer();
});

// 请求监控面板：展开状态、日志列表与汇总
const showLogPanel = ref(false);
const logs = ref<ChatLogEntry[]>([]);
const logsSummary = ref<LogsSummary | null>(null);

/** 请求监控汇总卡片（供模板 v-for） */
const obsSummaryCells = computed(() => {
  const s = logsSummary.value;
  if (!s) return [];
  const ragLine = `${s.ragRequestCount} 次 / ${s.ragHitRequestCount} 次命中${
    s.ragHitRate != null ? `（命中率 ${s.ragHitRate}%）` : ""
  }`;
  return [
    { k: "成功 / 失败", v: `${s.successCount} / ${s.errorCount}` },
    { k: "平均耗时", v: `${s.avgElapsedMs} ms` },
    { k: "累计输出 token", v: String(s.totalOutputTokens) },
    { k: "粗算总成本 USD", v: `~${s.totalEstimatedCostUsd}` },
    { k: "RAG 请求 / 命中资料", v: ragLine }
  ];
});

// 流式调试：页面内 + console，便于对照后端终端 [stream-demo ...] 日志
const showStreamDebug = ref(false);
const streamDebugLines = ref<string[]>([]);
const MAX_STREAM_DEBUG = 80;

function pushStreamDebug(line: string) {
  const t = new Date().toISOString().slice(11, 23);
  const full = `[${t}] ${line}`;
  streamDebugLines.value.unshift(full);
  if (streamDebugLines.value.length > MAX_STREAM_DEBUG) {
    streamDebugLines.value.length = MAX_STREAM_DEBUG;
  }
  console.log("[流式调试]", full);
}

const streamDebugText = computed(() => streamDebugLines.value.join("\n"));

function clearStreamDebug() {
  streamDebugLines.value = [];
}

// 流式追加一个字：用「固定下标」splice 替换整条消息，触发 Vue 更新。
// 注意：不能用 indexOf(旧对象)——第一次 splice 后旧引用已不在数组里，indexOf 永远是 -1，只会显示第一个字。
function appendStreamToken(assistantIndex: number, token: string) {
  const list = messages.value;
  const msg = list[assistantIndex];
  if (!msg || msg.role !== "assistant") return;
  list.splice(assistantIndex, 1, {
    ...msg,
    content: (msg.content || "") + token
  });
}

// 只更新助手消息里的 sources（仍用下标，读当前数组里的对象）
function setAssistantSources(assistantIndex: number, sources: RagSource[]) {
  const list = messages.value;
  const msg = list[assistantIndex];
  if (!msg || msg.role !== "assistant") return;
  list.splice(assistantIndex, 1, { ...msg, sources });
}

// 用于中断请求（点击“停止生成”时调用）
let currentAbortController: AbortController | null = null;

// 切换请求监控面板显示/隐藏
function toggleLogPanel() {
  showLogPanel.value = !showLogPanel.value;
  if (showLogPanel.value) fetchLogs();
}

// 从后端拉取监控数据（GET /api/logs：明细 + 汇总）
async function fetchLogs() {
  try {
    const res = await fetch(`${getApiBase()}/api/logs`);
    const data = (await res.json()) as LogsApiResponse;
    if (data?.ok && Array.isArray(data.logs)) logs.value = data.logs;
    logsSummary.value = data?.summary || null;
  } catch {
    logs.value = [];
    logsSummary.value = null;
  }
}

// 选择上传文件：这里只记录文件对象，实际读取在上传时进行（与主区 el-upload 合成事件一致）
function onFileChange(event: { target: { files: File[] } }) {
  const file = event.target.files[0] ?? null;
  selectedFile.value = file;
}

function onRagUploadChange(uploadFile: UploadFile) {
  const raw = uploadFile.raw;
  if (!raw) return;
  onFileChange({ target: { files: [raw] } });
}

// 上传 txt/md 到后端 RAG（SQLite 持久化 + 内存索引）
async function uploadRagFile() {
  if (!selectedFile.value || uploadingFile.value) return;
  uploadingFile.value = true;
  ragStatusText.value = "";

  try {
    // 浏览器原生 API：直接把文件内容读成文本
    const content = await selectedFile.value.text();
    const response = await fetch("/api/rag/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedFile.value.name,
        content
      })
    });
    const data = await response.json();
    if (!response.ok) {
      ragStatusText.value = `上传失败：${data?.error || "未知错误"}`;
      return;
    }
    ragStatusText.value = `上传成功：${data.title}，切分 ${data.chunkCount} 段（总段数 ${data.totalChunks}）`;
  } catch (error) {
    ragStatusText.value = `上传异常：${String(error)}`;
  } finally {
    uploadingFile.value = false;
  }
}

// 发送消息并处理流式响应
async function sendMessage() {
  const userText = inputText.value.trim();
  if (!userText || isGenerating.value) return;

  // 1) 先把用户消息推到列表里
  messages.value.push({ role: "user", content: userText });

  // 2) 再放一个“空的助手消息”，后面流式 token 不断追加到这里
  messages.value.push({ role: "assistant", content: "", sources: [] });
  const assistantIndex = messages.value.length - 1;

  // 3) 清空输入框，准备请求
  inputText.value = "";
  isGenerating.value = true;
  ragMatchHint.value = "";
  currentAbortController = new AbortController();

  try {
    // 把当前会话发送给后端，后端会继续调用大模型
    const response = await fetch(`${getApiBase()}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel.value,
        systemPrompt: systemPrompt.value,
        useRag: useRag.value,
        messages: messages.value.filter((m) => m.role === "user" || m.role === "assistant")
      }),
      signal: currentAbortController.signal
    });

    if (!response.ok || !response.body) {
      const m = messages.value[assistantIndex];
      messages.value.splice(assistantIndex, 1, {
        ...m,
        content: "请求失败，请检查后端日志或 API Key。"
      });
      pushStreamDebug(`[chat] 请求失败 status=${response.status}`);
      return;
    }

    pushStreamDebug(`[chat] 开始读 SSE，URL=${getApiBase()}/api/chat/stream`);

    // 读取后端返回的 SSE 文本流
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let chatReadCount = 0;
    let chatBytes = 0;
    let chatTokens = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        pushStreamDebug(
          `[chat] read 结束：${chatReadCount} 次 chunk，${chatBytes} 字节，约 ${chatTokens} 个 token 片段`
        );
        break;
      }
      chatReadCount += 1;
      chatBytes += value?.byteLength ?? 0;
      if (chatReadCount <= 5) {
        pushStreamDebug(`[chat] 第 ${chatReadCount} 次 read，${value?.byteLength ?? 0} 字节`);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        try {
          // 每一行 data: 后面都是 JSON 事件
          const event = JSON.parse(line.slice(5).trim()) as SseDataLine;

          // token：flushSync 同步刷 DOM，否则长循环里更新会攒到最后才显示
          if (event.type === "token" && event.token) {
            chatTokens += 1;
            appendStreamToken(assistantIndex, event.token);
          }
          // rag_status 事件：提示是否命中知识片段
          if (event.type === "rag_status" && event.enabled) {
            ragMatchHint.value = event.matched
              ? `RAG 已命中 ${event.count} 个片段，本次回答会更偏向你的文档。`
              : "RAG 未命中文档片段，本次回答可能与未开启 RAG 接近。";
          }
          // sources 事件用于展示本次回答参考了哪些文档片段
          if (event.type === "sources" && Array.isArray(event.sources)) {
            setAssistantSources(assistantIndex, event.sources);
          }

          // error 事件显示错误信息
          if (event.type === "error") {
            const m = messages.value[assistantIndex];
            const errMsg = typeof event.message === "string" ? event.message : "";
            messages.value.splice(assistantIndex, 1, {
              ...m,
              content: (m.content || "") + `\n[错误] ${errMsg}`
            });
          }
        } catch {
          // 解析失败直接忽略，避免中断主流程
        }
      }
    }
  } catch (error) {
    const idx = messages.value.length - 1;
    const m = messages.value[idx];
    if (!m) return;
    if (String(error).includes("AbortError")) {
      messages.value.splice(idx, 1, { ...m, content: (m.content || "") + "\n[已停止生成]" });
    } else {
      messages.value.splice(idx, 1, { ...m, content: (m.content || "") + `\n[请求异常] ${String(error)}` });
    }
  } finally {
    isGenerating.value = false;
    currentAbortController = null;
    // 一轮对话结束（成功/失败/中止）后把当前会话写回 localStorage
    persistCurrentSession();
  }
}

// 停止生成：中断当前请求
function stopGenerating() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

// 点击模板后，直接替换系统提示词
function applyTemplate(value: string) {
  systemPrompt.value = value;
}

// 流式测试：调用后端 demo 接口，不调大模型，一字一字推送
// 若能看到打字机效果，说明流式链路正常；否则问题在代理/网络/模型返回节奏
async function runStreamDemo() {
  if (isGenerating.value) return;
  messages.value.push({ role: "user", content: "[流式测试]" });
  messages.value.push({ role: "assistant", content: "", sources: [] });
  const assistantIndex = messages.value.length - 1;
  isGenerating.value = true;

  const url = `${getApiBase()}/api/stream-demo`;
  pushStreamDebug(`[demo] 准备请求 GET ${url}`);
  pushStreamDebug(`[demo] getApiBase=${JSON.stringify(getApiBase())} import.meta.env.DEV=${import.meta.env.DEV}`);

  let readCount = 0;
  let totalBytes = 0;
  let tokenCount = 0;

  try {
    const res = await fetch(url);
    pushStreamDebug(`[demo] fetch 已返回 status=${res.status} ok=${res.ok} body=${!!res.body}`);
    if (!res.ok || !res.body) {
      const m = messages.value[assistantIndex];
      if (m) {
        messages.value.splice(assistantIndex, 1, { ...m, content: "流式测试请求失败" });
      }
      pushStreamDebug(`[demo] 中止：无 body 或状态非 2xx`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        pushStreamDebug(
          `[demo] read 结束：共 ${readCount} 次 chunk，${totalBytes} 字节，解析 token ${tokenCount} 个`
        );
        if (readCount === 1 && tokenCount > 5) {
          pushStreamDebug(
            "[demo] 提示：若 chunk 只有 1 次但 token 很多，说明浏览器/网络把流攒成了一大块（仍可能逐字显示，看 nextTick）"
          );
        }
        break;
      }
      readCount += 1;
      const n = value?.byteLength ?? 0;
      totalBytes += n;
      if (readCount <= 8) {
        pushStreamDebug(`[demo] 第 ${readCount} 次 read，本块 ${n} 字节`);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5).trim()) as SseDataLine;
          if (event.type === "token" && event.token) {
            tokenCount += 1;
            if (tokenCount <= 5) {
              pushStreamDebug(`[demo] token #${tokenCount} ${JSON.stringify(event.token)}`);
            }
            appendStreamToken(assistantIndex, event.token);
          }
          if (event.type === "done") {
            pushStreamDebug("[demo] 收到 SSE type=done");
          }
        } catch (e) {
          pushStreamDebug(`[demo] 解析一行失败: ${String(e)}`);
        }
      }
    }
  } catch (e) {
    const m = messages.value[assistantIndex];
    if (m) {
      messages.value.splice(assistantIndex, 1, { ...m, content: `流式测试异常：${String(e)}` });
    }
    pushStreamDebug(`[demo] catch: ${String(e)}`);
  } finally {
    isGenerating.value = false;
    persistCurrentSession();
  }
}
</script>
