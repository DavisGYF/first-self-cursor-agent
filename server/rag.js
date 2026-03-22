/**
 * P2：RAG 增强 — 智能分块 + BM25 检索（无需向量 API，适合 Demo/简历）
 * 数据仍在内存 ragChunks，重启清空；后续可换向量库 + 同接口
 */
import dotenv from "dotenv";

dotenv.config();

const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE) || 480;
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP) || 90;
const DEFAULT_TOP_K = Number(process.env.RAG_TOP_K) || 3;
/** 相对最高分保留片段：低于 bestScore * 此比例的不注入上下文（减少胡编） */
const MIN_RELATIVE_SCORE = Number(process.env.RAG_MIN_RELATIVE_SCORE) || 0.22;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const ragChunks = [];
let ragDocId = 1;

// 分词：英文按词 + 中文单字（短问句仍可命中）
export function tokenize(text) {
  const normalized = String(text).toLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .filter(Boolean);
  const cjkChars = [...normalized].filter((ch) => /[\u4e00-\u9fff]/u.test(ch));
  return [...words, ...cjkChars];
}

/**
 * 先按空行拆「段落」，过长段落再滑窗；比固定长度一刀切更利于保留语义边界
 */
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

  // 合并过短块，减少碎片（相邻块合并到不超过 CHUNK_SIZE）
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

/**
 * BM25：比「纯词频重合」更稳，能抑制常见词、突出区分度
 */
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

/**
 * 检索：BM25 排序 + 相对阈值过滤 + topK
 */
export function searchChunks(query, topK = DEFAULT_TOP_K) {
  const k = Math.min(Math.max(Number(topK) || DEFAULT_TOP_K, 1), 20);
  if (!ragChunks.length) return [];

  const scored = bm25Score(query, ragChunks);
  if (!scored.length) return [];

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const minAbs = best * MIN_RELATIVE_SCORE;
  const filtered = scored.filter((s) => s.score >= minAbs).slice(0, k);
  return filtered;
}

/** 上传：切分并写入内存块 */
export function ingestUpload({ title = "", content = "" }) {
  const docId = ragDocId++;
  const safeTitle = String(title).trim() || `doc-${docId}.txt`;
  const chunks = splitIntoChunksSmart(content);

  chunks.forEach((text, idx) => {
    ragChunks.push({
      id: `${docId}-${idx + 1}`,
      docId,
      title: safeTitle,
      chunkIndex: idx + 1,
      text,
    });
  });

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

/** 供健康检查或调试 */
export function getRagConfigSummary() {
  return {
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    topK: DEFAULT_TOP_K,
    minRelativeScore: MIN_RELATIVE_SCORE,
    retrieval: "bm25",
  };
}
