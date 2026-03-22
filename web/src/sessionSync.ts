/**
 * P1：与服务端 SQLite 会话同步（匿名 X-Client-Id，与 localStorage 双写）
 */
import type { PutSessionsPayload, SessionsApiResponse } from "./types";
import { getApiBase } from "./apiBase";

const CLIENT_KEY = "ai-copilot-client-id";

function randomUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = randomUuid();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export async function fetchServerSessions(): Promise<SessionsApiResponse> {
  const r = await fetch(`${getApiBase()}/api/sessions`, {
    headers: { "X-Client-Id": getOrCreateClientId() }
  });
  if (!r.ok) throw new Error(`GET /api/sessions ${r.status}`);
  return r.json() as Promise<SessionsApiResponse>;
}

export async function putServerSessions(payload: PutSessionsPayload): Promise<unknown> {
  const r = await fetch(`${getApiBase()}/api/sessions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getOrCreateClientId()
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`PUT /api/sessions ${r.status} ${errText}`);
  }
  return r.json();
}
