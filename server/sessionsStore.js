/**
 * 按 client_id（浏览器匿名 UUID）读写会话列表与侧栏顺序
 */
import { db } from "./db.js";

function rowToSession(row) {
  let messages = [];
  try {
    messages = JSON.parse(row.messages_json || "[]");
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
  }
  return {
    id: row.id,
    title: row.title,
    titleLocked: !!row.title_locked,
    systemPrompt: row.system_prompt || undefined,
    selectedModel: row.selected_model || undefined,
    messages,
    updatedAt: row.updated_at,
  };
}

export function getClientState(clientId) {
  const orderRow = db
    .prepare(
      "SELECT order_json FROM client_session_order WHERE client_id = ?",
    )
    .get(clientId);

  const rows = db
    .prepare(
      "SELECT id, client_id, title, title_locked, system_prompt, selected_model, messages_json, updated_at FROM chat_sessions WHERE client_id = ?",
    )
    .all(clientId);

  const sessions = rows.map(rowToSession);

  let sessionOrder = [];
  try {
    sessionOrder = orderRow ? JSON.parse(orderRow.order_json) : [];
    if (!Array.isArray(sessionOrder)) sessionOrder = [];
  } catch {
    sessionOrder = [];
  }

  const known = new Set(sessions.map((s) => s.id));
  sessionOrder = sessionOrder.filter((id) => known.has(id));
  for (const s of sessions) {
    if (!sessionOrder.includes(s.id)) sessionOrder.push(s.id);
  }

  return { sessions, sessionOrder };
}

export function putClientState(clientId, { sessions, sessionOrder }) {
  if (!Array.isArray(sessions)) {
    throw new Error("sessions must be an array");
  }
  if (sessions.length > 500) {
    throw new Error("too many sessions");
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM chat_sessions WHERE client_id = ?").run(clientId);

    const ins = db.prepare(`
      INSERT INTO chat_sessions (
        id, client_id, title, title_locked, system_prompt, selected_model, messages_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of sessions) {
      if (!s || typeof s.id !== "string" || !s.id.trim()) continue;
      const messagesJson = JSON.stringify(s.messages ?? []);
      if (messagesJson.length > 8 * 1024 * 1024) {
        throw new Error("single session messages too large");
      }
      ins.run(
        s.id.trim(),
        clientId,
        String(s.title || "新会话").slice(0, 200),
        s.titleLocked ? 1 : 0,
        s.systemPrompt != null ? String(s.systemPrompt) : null,
        s.selectedModel != null ? String(s.selectedModel) : null,
        messagesJson,
        Number(s.updatedAt) || Date.now(),
      );
    }

    const orderJson = JSON.stringify(
      Array.isArray(sessionOrder) ? sessionOrder : [],
    );
    db.prepare(
      "INSERT OR REPLACE INTO client_session_order (client_id, order_json) VALUES (?, ?)",
    ).run(clientId, orderJson);
  });

  tx();
}
