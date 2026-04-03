import type { SourceChunkRecord, SourceFileRecord } from "./types";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "ours",
  "she",
  "so",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

function tokenize(s: string): string[] {
  const raw = (s || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9$%.\-+/\s]/g, " ")
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

function freq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function buildIdf(allChunks: Array<{ id: string; tokens: string[] }>): Map<string, number> {
  const df = new Map<string, number>();
  for (const c of allChunks) {
    const seen = new Set<string>();
    for (const t of c.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const N = Math.max(1, allChunks.length);
  const idf = new Map<string, number>();
  df.forEach((d, t) => {
    // Smoothed IDF. Lower-bounded so we don't overweight ultra-rare garbage tokens.
    const v = Math.log(1 + (N + 1) / (d + 1));
    idf.set(t, Math.max(0.2, v));
  });
  return idf;
}

function categoryBoost(category: SourceFileRecord["category"]): number {
  // Mild bias toward credit-critical artifacts when relevance ties.
  switch (category) {
    case "debt_document":
      return 1.18;
    case "sec_filing":
      return 1.12;
    case "model_spreadsheet":
      return 1.08;
    case "transcript":
      return 1.06;
    case "presentation":
      return 1.04;
    case "notes":
      return 1.06;
    default:
      return 1.0;
  }
}

export type RankedChunk = {
  chunk: SourceChunkRecord;
  score: number;
};

/**
 * Rank chunks by lexical relevance to a memo request string (title + outline headings).
 * Lightweight TF*IDF-ish scoring; deterministic and dependency-free.
 */
export function rankChunksByRelevance(params: {
  sources: SourceFileRecord[];
  chunks: SourceChunkRecord[];
  query: string;
}): RankedChunk[] {
  const qTokens = tokenize(params.query);
  const qFreq = freq(qTokens);

  const chunkTokens = params.chunks.map((c) => ({ id: c.id, tokens: tokenize(c.text) }));
  const idf = buildIdf(chunkTokens);

  const sourceById = new Map<string, SourceFileRecord>();
  for (const s of params.sources) sourceById.set(s.id, s);

  const ranked: RankedChunk[] = [];
  for (const c of params.chunks) {
    const tokens = tokenize(c.text);
    if (tokens.length === 0) continue;
    const f = freq(tokens);
    let score = 0;
    qFreq.forEach((qn, t) => {
      const tf = f.get(t) ?? 0;
      if (tf <= 0) return;
      const w = idf.get(t) ?? 0.2;
      score += Math.log(1 + tf) * w * Math.log(1 + qn);
    });

    // Add small bonus for section labels matching query tokens (helps outline-aligned chunks).
    if (c.sectionLabel) {
      const st = tokenize(c.sectionLabel);
      for (const t of st) {
        if (!qFreq.has(t)) continue;
        score += 0.25 * (idf.get(t) ?? 0.2);
      }
    }

    // Normalize a bit for chunk length to avoid huge chunks always winning.
    const lenNorm = 1 / Math.sqrt(80 + tokens.length);
    score *= 1 + 12 * lenNorm;

    const src = sourceById.get(c.sourceFileId);
    if (src) score *= categoryBoost(src.category);

    ranked.push({ chunk: c, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

