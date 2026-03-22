/**
 * SQLite 连接与会话表（P1：服务端会话，与 chat/stream、RAG 并行）
 * 数据文件默认：server/data/copilot.db，可通过环境变量 DATABASE_PATH 覆盖
 */
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const dbPath =
  process.env.DATABASE_PATH || path.join(dataDir, "copilot.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_locked INTEGER NOT NULL DEFAULT 0,
    system_prompt TEXT,
    selected_model TEXT,
    messages_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_client ON chat_sessions(client_id);

  CREATE TABLE IF NOT EXISTS client_session_order (
    client_id TEXT PRIMARY KEY,
    order_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rag_chunks (
    chunk_id TEXT PRIMARY KEY,
    doc_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks(doc_id);
`);
