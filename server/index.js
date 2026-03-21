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
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

// 健康检查接口：浏览器打开可快速确认服务是否正常
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ai-copilot-server" });
});

// 流式聊天接口：前端通过 fetch + ReadableStream 一边收一边展示
app.post("/api/chat/stream", async (req, res) => {
  try {
    // 请求体可传 model/messages/systemPrompt，不传就走默认值
    const { model = DEFAULT_MODEL, messages = [], systemPrompt = "" } = req.body || {};

    // 如果没配 key，直接报错并提示如何修复
    if (!OPENAI_API_KEY) {
      return res.status(400).json({
        error: "Missing OPENAI_API_KEY. Please copy .env.example to .env and fill key."
      });
    }

    // 构造发送给模型的消息：系统提示 + 用户历史消息
    const finalMessages = [];
    if (systemPrompt?.trim()) {
      finalMessages.push({ role: "system", content: systemPrompt.trim() });
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

    // 调用兼容 OpenAI 的 Chat Completions 流式接口
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: finalMessages,
        temperature: 0.7
      })
    });

    // 如果上游接口失败，透传错误，便于你定位问题
    if (!response.ok || !response.body) {
      const errorText = await response.text();
      res.write(`data: ${JSON.stringify({ type: "error", message: errorText })}\n\n`);
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
    res.write(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`AI server running at http://localhost:${PORT}`);
});
