<template>
  <div class="panel">
    <h1 class="title">AI Copilot Demo（Vue + Express）</h1>
    <p class="subtitle">这是你的学习版项目：支持对话、流式输出、RAG 上传与引用展示。</p>

    <div class="row">
      <select v-model="selectedModel">
        <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
      </select>
      <button @click="resetChat">新建会话</button>
    </div>

    <div class="row">
      <select @change="applyTemplate($event.target.value)">
        <option v-for="item in promptTemplates" :key="item.label" :value="item.value">
          {{ item.label }}
        </option>
      </select>
    </div>

    <div class="row">
      <textarea
        v-model="systemPrompt"
        rows="3"
        placeholder="系统提示词（告诉模型你希望它扮演什么角色）"
      />
    </div>

    <div class="row" style="align-items: center;">
      <label style="display: flex; align-items: center; gap: 6px;">
        <input v-model="useRag" type="checkbox" />
        启用 RAG（让回答参考你上传的文档）
      </label>
    </div>

    <div class="row">
      <input type="file" accept=".txt,.md,text/plain,text/markdown" @change="onFileChange" />
      <button :disabled="!selectedFile || uploadingFile" @click="uploadRagFile">
        {{ uploadingFile ? "上传中..." : "上传知识库文件" }}
      </button>
    </div>
    <p v-if="ragStatusText" class="subtitle" style="margin-top: -4px;">{{ ragStatusText }}</p>

    <div class="messages">
      <div v-for="(msg, idx) in messages" :key="idx" class="msg" :class="msg.role === 'user' ? 'msg-user' : 'msg-assistant'">
        <strong>{{ msg.role === "user" ? "你：" : "AI：" }}</strong>{{ msg.content }}
        <div v-if="msg.role === 'assistant' && msg.sources?.length" class="source-box">
          <div class="source-title">引用来源：</div>
          <div v-for="source in msg.sources" :key="source.id" class="source-item">
            <strong>{{ source.title }} #{{ source.chunkIndex }}：</strong>{{ source.text }}
          </div>
        </div>
      </div>
    </div>

    <div class="row" style="margin-top: 12px;">
      <input
        v-model="inputText"
        placeholder="输入你的问题，回车发送"
        @keyup.enter="sendMessage"
      />
    </div>

    <div class="row">
      <button :disabled="isGenerating" @click="sendMessage">发送</button>
      <button :disabled="!isGenerating" @click="stopGenerating">停止生成</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";

// 预置几个模型名称，你可以按自己 key 支持的模型改
const models = ["gpt-4o-mini", "deepseek-chat", "qwen-plus"];

// 预置 Prompt 模板，方便你快速切换业务场景
const promptTemplates = [
  { label: "通用助手", value: "你是一个专业、简洁、可靠的中文 AI 助手。" },
  { label: "短视频脚本", value: "你是短视频编导，请按钩子-正文-结尾行动号召输出。" },
  { label: "SEO 写作", value: "你是 SEO 编辑，请输出结构化内容并兼顾可读性与关键词。" },
  { label: "客服助手", value: "你是客服专员，语气礼貌，先共情再给解决方案。" }
];

// 消息列表，角色分为 user / assistant
const messages = ref([]);

// 当前输入框内容
const inputText = ref("");

// 当前选择模型
const selectedModel = ref(models[0]);

// 当前系统提示词
const systemPrompt = ref(promptTemplates[0].value);

// 标记当前是否正在生成中
const isGenerating = ref(false);

// 是否启用 RAG 检索增强
const useRag = ref(false);

// 上传文件相关状态
const selectedFile = ref(null);
const uploadingFile = ref(false);
const ragStatusText = ref("");

// 用于中断请求（点击“停止生成”时调用）
let currentAbortController = null;

// 新开一个空会话
function resetChat() {
  messages.value = [];
}

// 选择上传文件：这里只记录文件对象，实际读取在上传时进行
function onFileChange(event) {
  const file = event?.target?.files?.[0] || null;
  selectedFile.value = file;
}

// 上传 txt/md 到后端 RAG 内存库
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
  const assistantMessage = { role: "assistant", content: "", sources: [] };
  messages.value.push(assistantMessage);

  // 3) 清空输入框，准备请求
  inputText.value = "";
  isGenerating.value = true;
  currentAbortController = new AbortController();

  try {
    // 把当前会话发送给后端，后端会继续调用大模型
    const response = await fetch("/api/chat/stream", {
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
      assistantMessage.content = "请求失败，请检查后端日志或 API Key。";
      return;
    }

    // 读取后端返回的 SSE 文本流
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        try {
          // 每一行 data: 后面都是 JSON 事件
          const event = JSON.parse(line.slice(5).trim());

          // token 事件就不断追加，让你看到“打字机效果”
          if (event.type === "token" && event.token) {
            assistantMessage.content += event.token;
          }
          // sources 事件用于展示本次回答参考了哪些文档片段
          if (event.type === "sources" && Array.isArray(event.sources)) {
            assistantMessage.sources = event.sources;
          }

          // error 事件显示错误信息
          if (event.type === "error") {
            assistantMessage.content += `\n[错误] ${event.message}`;
          }
        } catch {
          // 解析失败直接忽略，避免中断主流程
        }
      }
    }
  } catch (error) {
    // 如果是主动取消，就提示“已停止”
    if (String(error).includes("AbortError")) {
      messages.value[messages.value.length - 1].content += "\n[已停止生成]";
    } else {
      messages.value[messages.value.length - 1].content += `\n[请求异常] ${String(error)}`;
    }
  } finally {
    isGenerating.value = false;
    currentAbortController = null;
  }
}

// 停止生成：中断当前请求
function stopGenerating() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

// 点击模板后，直接替换系统提示词
function applyTemplate(value) {
  systemPrompt.value = value;
}
</script>
