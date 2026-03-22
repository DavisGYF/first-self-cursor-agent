/**
 * RAG：段落分块 + SQLite 持久化 + 可选向量检索（OpenAI 兼容 embeddings）
 * - 持久化：重启后从 copilot.db 读回文本块
 * - 向量：设 RAG_EMBEDDING=1 且配置 OPENAI_API_KEY 时上传后写入 embedding，检索用语义相似度
 */
import dotenv from "dotenv";
import { db } from "./db.js";

dotenv.config();

const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE) || 480;
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP) || 90;
const DEFAULT_TOP_K = Number(process.env.RAG_TOP_K) || 3;
const MIN_RELATIVE_SCORE = Number(process.env.RAG_MIN_RELATIVE_SCORE) || 0.22;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const EMBEDDING_MODEL =
  process.env.RAG_EMBEDDING_MODEL || "text-embedding-3-small";

/** 1=上传后打 embedding，检索优先用语义向量（需 OPENAI_API_KEY） */
const RAG_EMBEDDING_ENABLED = process.env.RAG_EMBEDDING === "1";

const ragChunks = [];
let ragDocId = 1;

// ---------- 启动时从 SQLite 载入 ----------
function loadRagFromDatabase() {
  try {
    const rows = db
      .prepare(
        `SELECT chunk_id, doc_id, chunk_index, title, text, embedding_json
         FROM rag_chunks ORDER BY doc_id, chunk_index`,
      )
      .all();
    for (const r of rows) {
      let embedding = null;
      if (r.embedding_json) {
        try {
          embedding = JSON.parse(r.embedding_json);
        } catch {
          embedding = null;
        }
      }
      ragChunks.push({
        id: r.chunk_id,
        docId: r.doc_id,
        title: r.title,
        chunkIndex: r.chunk_index,
        text: r.text,
        embedding,
      });
    }
    const maxRow = db.prepare("SELECT MAX(doc_id) AS m FROM rag_chunks").get();
    ragDocId = Number(maxRow?.m || 0) + 1;
  } catch (e) {
    console.warn("[RAG] 从数据库加载失败", e);
  }
}

loadRagFromDatabase();

export function tokenize(text) {
  const normalized = String(text).toLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .filter(Boolean);
  const cjkChars = [...normalized].filter((ch) => /[\u4e00-\u9fff]/u.test(ch));
  return [...words, ...cjkChars];
}

export function splitIntoChunksSmart(text) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const rawBlocks = clean.split(/\n\s*\n/u).map((p) => p.trim()).filter(Boolean);
  const blocks = [];
  for (const block of rawBlocks) {
    if (block.length <= CHUNK_SIZE) {
      blocks.push(block);
    } else {
      let start = 0;
      while (start < block.length) {
        const end = Math.min(start + CHUNK_SIZE, block.length);
        blocks.push(block.slice(start, end));
        if (end === block.length) break;
        start = end - CHUNK_OVERLAP;
      }
    }
  }

  const merged = [];
  let buf = "";
  for (const piece of blocks) {
    if (!buf) {
      buf = piece;
      continue;
    }
    if (buf.length + 1 + piece.length <= CHUNK_SIZE) {
      buf = `${buf}\n${piece}`;
    } else {
      merged.push(buf);
      buf = piece;
    }
  }
  if (buf) merged.push(buf);
  return merged;
}

function bm25Score(query, chunks) {
  const N = chunks.length;
  if (N === 0) return [];

  const queryTerms = [...new Set(tokenize(query))].filter(Boolean);
  if (!queryTerms.length) return [];

  const docs = chunks.map((c) => {
    const terms = tokenize(c.text);
    const tf = new Map();
    for (const t of terms) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    return { chunk: c, tf, len: Math.max(terms.length, 1) };
  });

  const avgdl = docs.reduce((s, d) => s + d.len, 0) / N;

  const idfMap = new Map();
  for (const qt of queryTerms) {
    let dfVal = 0;
    for (const doc of docs) {
      if (doc.tf.has(qt)) dfVal += 1;
    }
    if (dfVal > 0) {
      idfMap.set(qt, Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1));
    }
  }

  const scored = docs.map((d) => {
    let score = 0;
    for (const qt of queryTerms) {
      const idf = idfMap.get(qt);
      if (idf == null) continue;
      const tf = d.tf.get(qt) || 0;
      if (tf <= 0) continue;
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (d.len / avgdl));
      score += idf * ((tf * (BM25_K1 + 1)) / denom);
    }
    return { ...d.chunk, score };
  });

  return scored.filter((s) => s.score > 0);
}

function applyTopKRelative(scored, topK) {
  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const minAbs = best * MIN_RELATIVE_SCORE;
  return scored.filter((s) => s.score >= minAbs).slice(0, topK);
}

function bm25SearchSync(query, topK) {
  const k = Math.min(Math.max(Number(topK) || DEFAULT_TOP_K, 1), 20);
  if (!ragChunks.length) return [];
  const scored = bm25Score(query, ragChunks);
  if (!scored.length) return [];
  return applyTopKRelative(scored, k);
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

async function fetchEmbeddingSingle(text) {
  if (!OPENAI_API_KEY) return null;
  const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    console.warn("[RAG] embedding 请求失败", await res.text());
    return null;
  }
  const data = await res.json();
  return data?.data?.[0]?.embedding || null;
}

async function fetchEmbeddingsBatch(texts) {
  if (!OPENAI_API_KEY || !texts.length) return null;
  const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => String(t).slice(0, 8000)),
    }),
  });
  if (!res.ok) {
    console.warn("[RAG] batch embedding 失败", await res.text());
    return null;
  }
  const data = await res.json();
  const list = data?.data || [];
  list.sort((x, y) => x.index - y.index);
  return list.map((x) => x.embedding);
}

async function embedAndStoreForDoc(docId, texts) {
  const embeddings = await fetchEmbeddingsBatch(texts);
  if (!embeddings || embeddings.length !== texts.length) return;
  const upd = db.prepare(
    `UPDATE rag_chunks SET embedding_json = ? WHERE chunk_id = ?`,
  );
  for (let i = 0; i < texts.length; i++) {
    const chunkId = `${docId}-${i + 1}`;
    const json = JSON.stringify(embeddings[i]);
    upd.run(json, chunkId);
    const item = ragChunks.find((x) => x.id === chunkId);
    if (item) item.embedding = embeddings[i];
  }
}

function toPublicChunk(item) {
  return {
    id: item.id,
    docId: item.docId,
    title: item.title,
    chunkIndex: item.chunkIndex,
    text: item.text,
    score: item.score,
  };
}

/**
 * 检索：若启用向量且库中已有 embedding，则用语义相似度；否则 BM25
 */
export async function searchChunks(query, topK = DEFAULT_TOP_K) {
  const k = Math.min(Math.max(Number(topK) || DEFAULT_TOP_K, 1), 20);
  const withEmb = ragChunks.filter((c) => c.embedding?.length);
  if (
    RAG_EMBEDDING_ENABLED &&
    OPENAI_API_KEY &&
    withEmb.length > 0
  ) {
    const qEmb = await fetchEmbeddingSingle(query);
    if (qEmb) {
      const scored = withEmb.map((c) => ({
        ...c,
        score: cosineSimilarity(qEmb, c.embedding),
      }));
      const filtered = scored.filter((s) => s.score > 0);
      if (filtered.length) {
        return applyTopKRelative(filtered, k).map(toPublicChunk);
      }
    }
  }
  return bm25SearchSync(query, k).map(toPublicChunk);
}

const insertChunkStmt = db.prepare(
  `INSERT INTO rag_chunks (chunk_id, doc_id, chunk_index, title, text, embedding_json, created_at)
   VALUES (@chunk_id, @doc_id, @chunk_index, @title, @text, @embedding_json, @created_at)`,
);

/** 上传：切分 → SQLite → 内存；可选批量 embedding */
export async function ingestUpload({ title = "", content = "" }) {
  const docId = ragDocId++;
  const safeTitle = String(title).trim() || `doc-${docId}.txt`;
  const chunks = splitIntoChunksSmart(content);
  const now = Date.now();

  chunks.forEach((text, idx) => {
    const chunkId = `${docId}-${idx + 1}`;
    insertChunkStmt.run({
      chunk_id: chunkId,
      doc_id: docId,
      chunk_index: idx + 1,
      title: safeTitle,
      text,
      embedding_json: null,
      created_at: now,
    });
    ragChunks.push({
      id: chunkId,
      docId,
      title: safeTitle,
      chunkIndex: idx + 1,
      text,
      embedding: null,
    });
  });

  if (RAG_EMBEDDING_ENABLED && OPENAI_API_KEY && chunks.length) {
    await embedAndStoreForDoc(docId, chunks);
  }

  return {
    docId,
    title: safeTitle,
    chunkCount: chunks.length,
    totalChunks: ragChunks.length,
  };
}

export function getRagChunkTotal() {
  return ragChunks.length;
}

export function getRagConfigSummary() {
  return {
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    topK: DEFAULT_TOP_K,
    minRelativeScore: MIN_RELATIVE_SCORE,
    persistence: "sqlite",
    embeddingEnabled: RAG_EMBEDDING_ENABLED && !!OPENAI_API_KEY,
    retrieval:
      RAG_EMBEDDING_ENABLED && OPENAI_API_KEY ? "vector_or_bm25" : "bm25",
  };
}
