import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import "./db.js";
import { getClientState, putClientState } from "./sessionsStore.js";
import { ingestUpload, searchChunks, getRagConfigSummary } from "./rag.js";

// 【会话历史】P1：SQLite 持久化 + GET/PUT /api/sessions（请求头 X-Client-Id: UUID 标识匿名浏览器）
// 前端仍写 localStorage 作离线缓存；在线时与服务端双向同步。登录用户与多租户可后续扩展。
// db.js 内会先 dotenv.config()，再打开 SQLite，避免 import 顺序导致读不到 .env

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// 允许前端跨域；自定义头 X-Client-Id 用于会话归属（预检 OPTIONS）
app.use(
  cors({
    origin: true,
    allowedHeaders: ["Content-Type", "X-Client-Id"],
  }),
);

// 解析 JSON 请求体，让我们能直接拿到 req.body
app.use(express.json({ limit: "1mb" }));

const json10mb = express.json({ limit: "10mb" });

/** 匿名客户端 id：与前端 localStorage 里的 ai-copilot-client-id 一致 */
const CLIENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireClientId(req, res, next) {
  const raw = req.headers["x-client-id"];
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id || !CLIENT_ID_RE.test(id)) {
    return res.status(400).json({
      error: "需要请求头 X-Client-Id（UUID），用于标识当前浏览器客户端",
    });
  }
  req.clientId = id;
  next();
}

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

// =========================
// P3 可观测：单次请求日志 + 汇总（面试可讲：耗时、token、RAG 命中、粗算成本）
// =========================
const chatLogs = [];
const MAX_LOGS = 100;

/** 美元/1K tokens（示意价，可按 .env 覆盖；仅作 Demo 量级感） */
const COST_HINT = {
  "gpt-4o-mini": { inPer1k: 0.00015, outPer1k: 0.0006 },
  "gpt-4o": { inPer1k: 0.0025, outPer1k: 0.01 },
  "deepseek-chat": { inPer1k: 0.00014, outPer1k: 0.00028 },
  "qwen-plus": { inPer1k: 0.0005, outPer1k: 0.0015 },
  default: { inPer1k: 0.001, outPer1k: 0.002 },
};

function estimateCostUsd(model, estimatedPromptTokens, outputTokens) {
  const m = String(model || "");
  let rates = COST_HINT.default;
  if (COST_HINT[m]) rates = COST_HINT[m];
  else if (m.includes("gpt-4o-mini")) rates = COST_HINT["gpt-4o-mini"];
  else if (m.includes("deepseek")) rates = COST_HINT["deepseek-chat"];
  else if (m.includes("qwen")) rates = COST_HINT["qwen-plus"];
  else if (m.includes("gpt-4o")) rates = COST_HINT["gpt-4o"];
  const inTok = Math.max(0, estimatedPromptTokens || 0);
  const outTok = Math.max(0, outputTokens || 0);
  return (
    (inTok / 1000) * rates.inPer1k + (outTok / 1000) * rates.outPer1k
  );
}

/**
 * 记录一次 /api/chat/stream 相关调用
 * estimatedPromptTokens：用最终 messages JSON 长度粗估（非官方 usage，仅面板展示）
 */
function recordChatLog({
  startTime,
  model,
  useRag,
  outputTokens,
  error,
  ragHitCount = 0,
  ragMatched = false,
  estimatedPromptTokens = 0,
}) {
  const elapsed = Math.round(Date.now() - startTime);
  const outTok = outputTokens || 0;
  const inEst = Math.max(0, Number(estimatedPromptTokens) || 0);
  const log = {
    time: new Date().toISOString(),
    elapsed,
    model,
    useRag: !!useRag,
    ragMatched: !!ragMatched,
    ragHitCount: Number(ragHitCount) || 0,
    outputTokens: outTok,
    estimatedPromptTokens: inEst,
    error: error || null,
    status: error ? "error" : "ok",
    estimatedCostUsd: Number(
      estimateCostUsd(model, inEst, outTok).toFixed(6),
    ),
  };
  chatLogs.push(log);
  if (chatLogs.length > MAX_LOGS) chatLogs.shift();
}

function computeLogsSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const success = list.filter((l) => !l.error);
  const totalOut = success.reduce((s, l) => s + (l.outputTokens || 0), 0);
  const totalInEst = success.reduce((s, l) => s + (l.estimatedPromptTokens || 0), 0);
  const totalElapsed = success.reduce((s, l) => s + (l.elapsed || 0), 0);
  const ragReq = list.filter((l) => l.useRag);
  const ragHit = ragReq.filter((l) => l.ragMatched);
  const totalCost = list.reduce((s, l) => s + (l.estimatedCostUsd || 0), 0);
  return {
    totalRecorded: list.length,
    successCount: success.length,
    errorCount: list.length - success.length,
    totalOutputTokens: totalOut,
    totalEstimatedInputTokens: totalInEst,
    totalElapsedMs: totalElapsed,
    avgElapsedMs:
      success.length > 0 ? Math.round(totalElapsed / success.length) : 0,
    ragRequestCount: ragReq.length,
    ragHitRequestCount: ragHit.length,
    ragHitRate:
      ragReq.length > 0
        ? Math.round((ragHit.length / ragReq.length) * 100)
        : null,
    totalEstimatedCostUsd: Number(totalCost.toFixed(6)),
  };
}

// RAG：段落分块 + BM25 见 ./rag.js（P2）

// 进程启动时间：用于你确认「重启后是否已是新进程」（看 startedAt 是否变化）
const serverStartedAt = new Date().toISOString();

// 健康检查接口：浏览器打开可快速确认服务是否正常、是否已重启
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-copilot-server",
    startedAt: serverStartedAt,
    hasStreamDemo: true,
    hasSessionsApi: true,
    rag: getRagConfigSummary(),
  });
});

// ---------- 服务端会话（SQLite）----------
app.get("/api/sessions", requireClientId, (req, res) => {
  try {
    const { sessions, sessionOrder } = getClientState(req.clientId);
    res.json({ ok: true, sessions, sessionOrder });
  } catch (e) {
    console.error("[sessions GET]", e);
    res.status(500).json({ error: String(e) });
  }
});

app.put("/api/sessions", json10mb, requireClientId, (req, res) => {
  try {
    const { sessions, sessionOrder } = req.body || {};
    putClientState(req.clientId, { sessions, sessionOrder });
    res.json({ ok: true });
  } catch (e) {
    console.error("[sessions PUT]", e);
    const status =
      String(e.message || e).includes("too many") ||
      String(e.message || e).includes("must be")
        ? 400
        : 500;
    res.status(status).json({ error: String(e) });
  }
});

// 流式输出 demo：不调大模型，后端一个字一个字推送，用于验证前端流式渲染是否正常
// 如果点“流式测试”能看到打字机效果，说明流式链路没问题
app.get("/api/stream-demo", (req, res) => {
  const reqId = `demo-${Date.now()}`;
  // 终端里能看到：是否有人连上、第几个字写出、何时结束（排查「一次全出来」时对照前端）
  console.log(`[stream-demo ${reqId}] 客户端已连接`);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // 部分反向代理会缓冲 SSE，告诉代理不要缓冲（Nginx 等会认）
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const text =
    "流式输出测试：你能看到这段文字一个字一个字出现吗？如果可以，说明流式链路正常。";
  let i = 0;
  // 每 200ms 发一个字：比 500ms 快，仍便于观察打字机（可调）
  const timer = setInterval(() => {
    if (i >= text.length) {
      clearInterval(timer);
      console.log(`[stream-demo ${reqId}] 发送 done，共 ${i} 个 token`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }
    const ch = text[i];
    // 每发一个字打一行日志（字多时终端会刷屏，但能看出是否按间隔写出）
    if (i < 3 || i % 10 === 0 || i >= text.length - 1) {
      console.log(
        `[stream-demo ${reqId}] token #${i + 1} ${JSON.stringify(ch)} t=${Date.now()}`,
      );
    }
    res.write(`data: ${JSON.stringify({ type: "token", token: ch })}\n\n`);
    i += 1;
  }, 200);

  req.on("close", () => {
    clearInterval(timer);
    console.log(`[stream-demo ${reqId}] 客户端断开连接`);
  });
});

// 日志查询：明细 + 汇总（P3）
app.get("/api/logs", (_req, res) => {
  const arr = [...chatLogs];
  res.json({
    ok: true,
    logs: arr.reverse(),
    summary: computeLogsSummary(arr),
  });
});

// RAG 上传接口：切分后写入 SQLite + 内存；可选 embedding（见 rag.js）
app.post("/api/rag/upload", async (req, res) => {
  try {
    const { title = "", content = "" } = req.body || {};
    if (!String(content).trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    const result = await ingestUpload({ title, content });

    res.json({
      ok: true,
      docId: result.docId,
      title: result.title,
      chunkCount: result.chunkCount,
      totalChunks: result.totalChunks,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// RAG 查询接口：输入 query，返回相关性最高的前若干段
app.post("/api/rag/query", async (req, res) => {
  try {
    const { query = "", topK = 3 } = req.body || {};
    if (!String(query).trim()) {
      return res.status(400).json({ error: "query is required" });
    }

    const raw = await searchChunks(query, Number(topK) || 3);
    const sources = raw.map((item) => ({
      id: item.id,
      title: item.title,
      chunkIndex: item.chunkIndex,
      text: item.text,
      score: item.score,
    }));

    res.json({ ok: true, query, sources });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 流式聊天接口：前端通过 fetch + ReadableStream 一边收一边展示
app.post("/api/chat/stream", async (req, res) => {
  const startTime = Date.now();
  let outputTokens = 0;
  let ragHitCount = 0;
  let ragMatched = false;
  let estimatedPromptTokens = 0;

  try {
    // 请求体可传 model/messages/systemPrompt，不传就走默认值
    const {
      model = DEFAULT_MODEL,
      messages = [],
      systemPrompt = "",
      useRag = false,
    } = req.body || {};

    // 如果没配 key，直接报错并提示如何修复
    if (!OPENAI_API_KEY) {
      const estIn = Math.ceil(JSON.stringify(messages).length / 4);
      recordChatLog({
        startTime,
        model,
        useRag,
        outputTokens: 0,
        error: "Missing OPENAI_API_KEY",
        ragHitCount: 0,
        ragMatched: false,
        estimatedPromptTokens: estIn,
      });
      return res.status(400).json({
        error:
          "Missing OPENAI_API_KEY. Please copy .env.example to .env and fill key.",
      });
    }

    // 找出最后一条用户消息，作为本次 RAG 检索 query
    const latestUserMessage =
      [...messages]
        .reverse()
        .find((item) => item?.role === "user" && item?.content)?.content || "";
    const sources = useRag ? await searchChunks(latestUserMessage, 3) : [];

    // 构造发送给模型的消息：系统提示 +（可选）RAG上下文 + 用户历史消息
    const finalMessages = [];
    if (systemPrompt?.trim()) {
      finalMessages.push({ role: "system", content: systemPrompt.trim() });
    }
    if (sources.length > 0) {
      // 把检索片段拼到 system 消息里，要求模型优先基于资料回答
      const ragContext = sources
        .map(
          (item, idx) =>
            `【资料${idx + 1} | ${item.title}#${item.chunkIndex}】\n${item.text}`,
        )
        .join("\n\n");
      finalMessages.push({
        role: "system",
        content:
          "你必须优先根据给定资料回答；若资料不足，请明确说明“资料中未提供完整信息”。\n\n" +
          ragContext,
      });
    }
    for (const item of messages) {
      if (item?.role && item?.content) {
        finalMessages.push({ role: item.role, content: item.content });
      }
    }

    ragHitCount = sources.length;
    ragMatched = ragHitCount > 0;
    estimatedPromptTokens = Math.max(
      1,
      Math.ceil(JSON.stringify(finalMessages).length / 4),
    );

    // 设置 SSE 响应头，告诉浏览器这是流式文本
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // 告诉前端：流开始了（可用于显示“模型思考中”）
    res.write(`data: ${JSON.stringify({ type: "start" })}\n\n`);
    // 告诉前端本次 RAG 命中情况，便于你观察“为什么开关后效果差不多”
    if (useRag) {
      res.write(
        `data: ${JSON.stringify({
          type: "rag_status",
          enabled: true,
          matched: sources.length > 0,
          count: sources.length,
          retrieval: getRagConfigSummary().retrieval,
        })}\n\n`,
      );
    }
    // 如果开启了 RAG，把命中的来源先推给前端，方便页面展示引用（含 BM25 分，便于看置信度）
    if (sources.length > 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "sources",
          sources: sources.map((item) => ({
            id: item.id,
            title: item.title,
            chunkIndex: item.chunkIndex,
            text: item.text,
            score: typeof item.score === "number" ? item.score : undefined,
          })),
        })}\n\n`,
      );
    }

    // 调用兼容 OpenAI 的 Chat Completions 流式接口
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: finalMessages,
        // 降低温度提高稳定性；限制输出长度可减少等待时间
        temperature: useRag ? 0.2 : 0.5,
        max_tokens: 400,
      }),
    });

    // 如果上游接口失败，透传错误，便于你定位问题
    if (!response.ok || !response.body) {
      const errorText = await response.text();
      recordChatLog({
        startTime,
        model,
        useRag,
        outputTokens: 0,
        error: `API ${response.status}: ${errorText.slice(0, 200)}`,
        ragHitCount,
        ragMatched,
        estimatedPromptTokens,
      });
      res.write(
        `data: ${JSON.stringify({ type: "error", message: errorText })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      return res.end();
    }

    // 逐块读取上游返回内容
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // 把二进制块转成字符串并拼接到缓冲区
      buffer += decoder.decode(value, { stream: true });

      // OpenAI 流格式是按行分割，我们逐行处理
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          // 流结束，记录日志（耗时、token 数、无错误）
          recordChatLog({
            startTime,
            model,
            useRag,
            outputTokens,
            error: null,
            ragHitCount,
            ragMatched,
            estimatedPromptTokens,
          });
          res.write(
            `data: ${JSON.stringify({ type: "done", outputTokens, elapsed: Date.now() - startTime })}\n\n`,
          );
          res.end();
          return;
        }

        try {
          // 提取增量 token（delta content）
          const json = JSON.parse(data);
          const token = json?.choices?.[0]?.delta?.content || "";
          if (token) {
            outputTokens += 1;
            res.write(`data: ${JSON.stringify({ type: "token", token })}\n\n`);
          }
        } catch {
          // 有些非标准行会进这里，忽略即可
        }
      }
    }

    // 上游主动结束时，补发 done 事件
    recordChatLog({
      startTime,
      model,
      useRag,
      outputTokens,
      error: null,
      ragHitCount,
      ragMatched,
      estimatedPromptTokens,
    });
    res.write(
      `data: ${JSON.stringify({ type: "done", outputTokens, elapsed: Date.now() - startTime })}\n\n`,
    );
    res.end();
  } catch (error) {
    const body = req?.body || {};
    const estCatch = Math.ceil(JSON.stringify(body.messages || []).length / 4);
    recordChatLog({
      startTime,
      model: body.model || DEFAULT_MODEL,
      useRag: !!body.useRag,
      outputTokens: 0,
      error: String(error),
      ragHitCount,
      ragMatched,
      estimatedPromptTokens: estimatedPromptTokens || estCatch,
    });
    res.write(
      `data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`,
    );
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  }
});

// 若存在 web 构建产物，则同域托管（与前端生产环境 getApiBase() === '' 一致）
const webDist = path.join(__dirname, "..", "web", "dist");
const webIndex = path.join(webDist, "index.html");
if (fs.existsSync(webIndex)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(webIndex, (err) => {
      if (err) next(err);
    });
  });
}

// 启动服务
app.listen(PORT, () => {
  console.log(`AI server running at http://localhost:${PORT}`);
  if (fs.existsSync(webIndex)) {
    console.log(`Web UI (dist) served from ${webDist}`);
  }
});
