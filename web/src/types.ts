/** 共享类型：会话、消息、SSE、请求监控 */

export type ChatRole = "user" | "assistant";

export interface RagSource {
  id: string;
  title: string;
  chunkIndex: number;
  score?: number;
  text: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  sources?: RagSource[];
}

export interface SessionRecord {
  id: string;
  title: string;
  titleLocked?: boolean;
  messages: ChatMessage[];
  updatedAt: number;
  systemPrompt?: string;
  selectedModel?: string;
}

export interface PromptTemplate {
  label: string;
  value: string;
}

export type ServerSyncStatus = "idle" | "loading" | "synced" | "offline" | "error";

export interface SessionsApiResponse {
  sessions?: SessionRecord[];
  sessionOrder?: string[];
}

export interface PutSessionsPayload {
  sessions: SessionRecord[];
  sessionOrder: string[];
}

export interface LogsSummary {
  successCount: number;
  errorCount: number;
  avgElapsedMs: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number | string;
  ragRequestCount: number;
  ragHitRequestCount: number;
  ragHitRate?: number | null;
}

export interface ChatLogEntry {
  time?: string;
  error?: string;
  elapsed: number;
  outputTokens: number;
  estimatedPromptTokens?: number;
  estimatedCostUsd?: number | string;
  model: string;
  useRag?: boolean;
  ragMatched?: boolean;
  ragHitCount?: number;
}

export interface LogsApiResponse {
  ok?: boolean;
  logs?: ChatLogEntry[];
  summary?: LogsSummary | null;
}

/** 后端 SSE data: JSON 行（宽松） */
export interface SseDataLine {
  type: string;
  token?: string;
  enabled?: boolean;
  matched?: boolean;
  count?: number;
  sources?: RagSource[];
  message?: string;
}

/** 侧栏导出的会话备份 JSON */
export interface SessionsBackupPayload {
  sessions: SessionRecord[];
  sessionOrder?: string[];
  activeSessionId?: string;
}
