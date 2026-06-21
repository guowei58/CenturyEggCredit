import { loadCreditMemoConfig, MEMO_DECK_CONTEXT_MAX_CHARS } from "./config";
import { sortSourcesForEvidence, sortMemoDeckSourcesForEvidence } from "./memoPlanner";
import type { CreditMemoProject, SourceFileRecord } from "./types";
import { joinSourceChunksWithoutOverlap } from "./chunkStitch";

/**
 * Build capped evidence string with clear source boundaries for the LLM.
 *
 * Packing is **sequential**: memo/deck sources in priority order, then chunk index order within each
 * file (stitched without overlap duplication), until the global `maxChars` budget is exhausted.
 */
export function buildEvidencePackSync(
  project: CreditMemoProject,
  opts?: {
    maxChars?: number;
    query?: string;
    perFileMaxChars?: number;
    sourceIds?: Set<string>;
    /** When true, order sources for AI Memo & Deck (work-product outputs first). */
    memoDeckOrder?: boolean;
  }
): string {
  const cfg = loadCreditMemoConfig();
  let budget = Math.round(opts?.maxChars ?? cfg.maxContextChars);
  const parts: string[] = [];

  const sid = opts?.sourceIds;
  const sourceCount = sid?.size ? project.sources.filter((s) => sid.has(s.id)).length : project.sources.length;
  const header = `# SOURCE PACK\nTicker: ${project.ticker}\nFolder: ${project.resolvedFolderPath}\nFiles ingested: ${sourceCount}\n\n`;
  budget -= header.length;
  parts.push(header);

  const ordered = sid?.size
    ? (opts?.memoDeckOrder ? sortMemoDeckSourcesForEvidence : sortSourcesForEvidence)(project.sources).filter((s) =>
        sid.has(s.id)
      )
    : (opts?.memoDeckOrder ? sortMemoDeckSourcesForEvidence : sortSourcesForEvidence)(project.sources);

  for (const src of ordered) {
    if (src.parseStatus === "skipped") continue;

    const blockHead = `\n<<<BEGIN SOURCE: ${src.relPath} | category=${src.category} | status=${src.parseStatus}>>>\n`;
    const fileChunks = project.chunks
      .filter((c) => c.sourceFileId === src.id)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
    const body = joinSourceChunksWithoutOverlap(fileChunks);

    if (!body.trim()) continue;

    const maxBody = Math.max(0, budget - blockHead.length - 48);
    if (maxBody < 400) break;
    const clipped = body.length > maxBody ? `${body.slice(0, maxBody)}\n…[truncated for context budget]` : body;
    const block = blockHead + clipped + `\n<<<END SOURCE: ${src.relPath}>>>\n`;
    parts.push(block);
    budget -= block.length;
  }

  return parts.join("");
}

/** Build a short inventory list for prompts / UI */
export function formatSourceInventoryList(sources: SourceFileRecord[]): string {
  return sources
    .map((s) => `- ${s.relPath} (${s.category}, ${s.parseStatus}, ${s.charExtracted} chars)`)
    .join("\n");
}

export type MemoEvidenceSourceRow = {
  relPath: string;
  charsAvailable: number;
  packedChars: number;
  /** Populated when embedding retrieval ranked chunks; 0 when omitted from window. */
  chunksInWindow: number;
};

function inventorySources(project: CreditMemoProject): SourceFileRecord[] {
  return project.sources.filter((s) => s.parseStatus !== "skipped");
}

/** Parse per-source body lengths from a built evidence pack string. */
export function parseEvidencePackedCharsBySource(evidence: string): Map<string, number> {
  const out = new Map<string, number>();
  const beginRe = /<<<BEGIN SOURCE: ([^|>]+)[^>]*>>>/g;
  let m: RegExpExecArray | null;
  while ((m = beginRe.exec(evidence)) !== null) {
    const relPath = m[1].trim();
    const start = m.index + m[0].length;
    const endMarker = `<<<END SOURCE: ${relPath}>>>`;
    const end = evidence.indexOf(endMarker, start);
    if (end === -1) continue;
    // Strip framing newlines between BEGIN/END markers (not part of source text).
    const body = evidence.slice(start, end).replace(/^\n/, "").replace(/\n$/, "");
    out.set(relPath, body.length);
  }
  return out;
}

export function computeMemoEvidenceSourceRows(
  project: CreditMemoProject,
  evidence: string,
  chunkCountsByPath?: Map<string, number>
): MemoEvidenceSourceRow[] {
  const packedByPath = parseEvidencePackedCharsBySource(evidence);
  return inventorySources(project)
    .map((s) => ({
      relPath: s.relPath,
      charsAvailable: s.charExtracted,
      packedChars: packedByPath.get(s.relPath) ?? 0,
      chunksInWindow: chunkCountsByPath?.get(s.relPath) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.packedChars - a.packedChars ||
        b.charsAvailable - a.charsAvailable ||
        a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" })
    );
}
