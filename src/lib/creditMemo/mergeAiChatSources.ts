import { createHash } from "crypto";

import { parseAiChatFromServerPayload, type AiChatSession } from "@/lib/ai-chat-sessions";
import type { CreditMemoProject, SourceChunkRecord, SourceFileRecord } from "./types";
import { CREDIT_MEMO_CHUNK_MAX_CHARS, CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "./chunkConstants";

const VIRTUAL_REL = "_century_egg_research/AI_CHAT_SIDEBAR_HISTORY.md";

const CHUNK_CHARS = CREDIT_MEMO_CHUNK_MAX_CHARS;
const CHUNK_OVERLAP = CREDIT_MEMO_CHUNK_OVERLAP_CHARS;

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 22);
}

function chunkText(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= CHUNK_CHARS) return [t];
  const chunks: string[] = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(i + CHUNK_CHARS, t.length);
    let slice = t.slice(i, end);
    if (end < t.length) {
      const lastBreak = slice.lastIndexOf("\n\n");
      if (lastBreak > CHUNK_CHARS * 0.55) slice = slice.slice(0, lastBreak);
    }
    chunks.push(slice);
    const step = Math.max(1, slice.length - CHUNK_OVERLAP);
    i += step;
  }
  return chunks;
}

function detectSectionLabel(text: string): string | null {
  const lines = text.split("\n").slice(0, 8);
  for (const line of lines) {
    const l = line.trim();
    if (/^#+\s+/.test(l)) return l.replace(/^#+\s+/, "").slice(0, 120);
  }
  return null;
}

function formatSessionsMarkdown(ticker: string, sessions: AiChatSession[]): string {
  const ordered = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lines: string[] = [
    "# Sidebar AI Chat — research transcript",
    "",
    `This file was **merged automatically at ingest** from your in-app AI Chat (drawer) history.`,
    "",
    `**Credit memo / deck project ticker:** ${ticker}`,
    "",
    "Sessions are ordered **newest first** (by `updatedAt`). Treat as qualitative research notes; verify facts against primary sources.",
    "",
    "---",
    "",
  ];

  for (const s of ordered) {
    lines.push(`## Session: ${s.title || "Untitled"}`);
    lines.push("");
    lines.push(`- Session id: \`${s.id}\``);
    lines.push(`- Created: ${s.createdAt}`);
    lines.push(`- Updated: ${s.updatedAt}`);
    lines.push("");

    let turn = 0;
    for (const m of s.messages) {
      turn += 1;
      if (m.role === "user") {
        lines.push(`### Turn ${turn} — User`);
        lines.push("");
        lines.push((m.content ?? "").trim() || "_(empty)_");
        lines.push("");
      } else {
        lines.push(`### Turn ${turn} — Assistant`);
        lines.push("");
        lines.push((m.content ?? "").trim() || "_(empty)_");
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * After folder ingest, append sidebar AI Chat as a virtual `.md` source so memo/deck/KPI/etc.
 * evidence packs and chunk ranking can use it like any other ingested file.
 */
export function mergeAiChatIntoIngestedProject(
  project: CreditMemoProject,
  payload: string | null
): { project: CreditMemoProject; extraWarnings: string[] } {
  const extraWarnings: string[] = [];
  const { sessions } = parseAiChatFromServerPayload(payload ?? "");
  if (!sessions.length) {
    return { project, extraWarnings };
  }

  let body = formatSessionsMarkdown(project.ticker, sessions);

  const parts = chunkText(body);

  const sid = stableId(["src", project.id, VIRTUAL_REL]);
  const now = new Date().toISOString();
  const source: SourceFileRecord = {
    id: sid,
    relPath: VIRTUAL_REL,
    absPath: `_virtual/${VIRTUAL_REL}`,
    size: body.length,
    ext: ".md",
    category: "ai_chat",
    modifiedAt: now,
    parseStatus: "ok",
    charExtracted: body.length,
    parseNote: "Merged from User AI Chat state (not a disk file)",
  };

  const chunks: SourceChunkRecord[] = parts.map((p, idx) => ({
    id: stableId(["chk", sid, String(idx)]),
    sourceFileId: sid,
    chunkIndex: idx,
    text: p,
    sectionLabel: idx === 0 ? detectSectionLabel(p) : null,
  }));

  return {
    project: {
      ...project,
      sources: [...project.sources, source],
      chunks: [...project.chunks, ...chunks],
      updatedAt: now,
    },
    extraWarnings,
  };
}
