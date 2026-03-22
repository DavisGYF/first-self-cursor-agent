/**
 * P1：与服务端 SQLite 会话同步（匿名 X-Client-Id，与 localStorage 双写）
 */
import { getApiBase } from "./apiBase.js";

const CLIENT_KEY = "ai-copilot-client-id";

function randomUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = randomUuid();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export async function fetchServerSessions() {
  const r = await fetch(`${getApiBase()}/api/sessions`, {
    headers: { "X-Client-Id": getOrCreateClientId() },
  });
  if (!r.ok) throw new Error(`GET /api/sessions ${r.status}`);
  return r.json();
}

export async function putServerSessions(payload) {
  const r = await fetch(`${getApiBase()}/api/sessions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getOrCreateClientId(),
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`PUT /api/sessions ${r.status} ${errText}`);
  }
  return r.json();
}
