import cors from "cors";
import dotenv from "dotenv";
import express from "express";

// 加载 .env 环境变量，方便本地开发时读取 key/baseURL
dotenv.config();

const app = express();

// 允许前端跨域访问后端接口（开发阶段最省事）
app.use(cors());

// 解析 JSON 请求体，让我们能直接拿到 req.body
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

// =========================
// 以下是最小 RAG 内存实现（学习版）
// =========================
// 用数组把上传内容存在内存中，重启服务后会清空（这是预期行为）
const ragChunks = [];
let ragDocId = 1;

// 分词优化：
// 1) 英文/数字按词切分
// 2) 中文额外拆成单字，提升“退款几天到账”这类短问句命中率
function tokenize(text) {
  const normalized = String(text).toLowerCase();
  // 这个增加分词优化
  // 我上传本地txt文件里面写了退款时间 用不用RGA回答都一样 问问题他识别不出来 然后这一步优化以后就行了
  const words = normalized
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .filter(Boolean);

  const cjkChars = [...normalized].filter((ch) => /[\u4e00-\u9fff]/u.test(ch));

  return [...words, ...cjkChars];
}

// 把长文本切成多个小块，便于后续做相似度检索
function splitTextIntoChunks(text, chunkSize = 300, overlap = 60) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return [];

  const result = [];
  let start = 0;
  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    result.push(cleanText.slice(start, end));
    if (end === cleanText.length) break;
    start = end - overlap;
  }
  return result;
}

// 用“关键词重合数量”做一个最小可用的相关性评分
function searchChunks(query, topK = 3) {
  const queryTokens = new Set(tokenize(query));
  if (!queryTokens.size) return [];

  const scored = ragChunks
    .map((item) => {
      const chunkTokens = tokenize(item.text);
      let score = 0;
      for (const token of chunkTokens) {
        if (queryTokens.has(token)) score += 1;
      }
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

// 健康检查接口：浏览器打开可快速确认服务是否正常
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ai-copilot-server" });
});

// RAG 上传接口：前端把 txt/md 内容传上来，后端做切分并缓存到内存
app.post("/api/rag/upload", (req, res) => {
  try {
    const { title = "", content = "" } = req.body || {};
    if (!String(content).trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    const docId = ragDocId++;
    const safeTitle = String(title).trim() || `doc-${docId}.txt`;
    const chunks = splitTextIntoChunks(content);

    chunks.forEach((text, idx) => {
      ragChunks.push({
        id: `${docId}-${idx + 1}`,
        docId,
        title: safeTitle,
        chunkIndex: idx + 1,
        text,
      });
    });

    res.json({
      ok: true,
      docId,
      title: safeTitle,
      chunkCount: chunks.length,
      totalChunks: ragChunks.length,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// RAG 查询接口：输入 query，返回相关性最高的前 3 段
app.post("/api/rag/query", (req, res) => {
  try {
    const { query = "", topK = 3 } = req.body || {};
    if (!String(query).trim()) {
      return res.status(400).json({ error: "query is required" });
    }

    const sources = searchChunks(query, Number(topK) || 3).map((item) => ({
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
    const sources = useRag ? searchChunks(latestUserMessage, 3) : [];

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
        })}\n\n`,
      );
    }
    // 如果开启了 RAG，把命中的来源先推给前端，方便页面展示引用
    if (sources.length > 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "sources",
          sources: sources.map((item) => ({
            id: item.id,
            title: item.title,
            chunkIndex: item.chunkIndex,
            text: item.text,
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
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          return;
        }

        try {
          // 提取增量 token（delta content）
          const json = JSON.parse(data);
          const token = json?.choices?.[0]?.delta?.content || "";
          if (token) {
            res.write(`data: ${JSON.stringify({ type: "token", token })}\n\n`);
          }
        } catch {
          // 有些非标准行会进这里，忽略即可
        }
      }
    }

    // 上游主动结束时，补发 done 事件
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    // 统一兜底错误，避免接口挂死
    res.write(
      `data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`,
    );
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AI server running at http://localhost:${PORT}`);
});
