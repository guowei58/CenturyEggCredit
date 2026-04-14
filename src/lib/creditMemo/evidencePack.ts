import { loadCreditMemoConfig } from "./config";
import { sortSourcesForEvidence } from "./memoPlanner";
import type { CreditMemoProject, SourceFileRecord } from "./types";
import { rankChunksByRelevance } from "./chunkRanker";

/**
 * Build capped evidence string with clear source boundaries for the LLM.
 */
export function buildEvidencePackSync(
  project: CreditMemoProject,
  opts?: { maxChars?: number; query?: string; perFileMaxChars?: number; sourceIds?: Set<string> }
): string {
  const cfg = loadCreditMemoConfig();
  let budget = Math.max(40_000, Math.round(opts?.maxChars ?? cfg.maxContextChars));
  const parts: string[] = [];

  const sid = opts?.sourceIds;
  const sourceCount = sid?.size ? project.sources.filter((s) => sid.has(s.id)).length : project.sources.length;
  const header = `# SOURCE PACK\nTicker: ${project.ticker}\nFolder: ${project.resolvedFolderPath}\nFiles ingested: ${sourceCount}\n\n`;
  budget -= header.length;
  parts.push(header);

  let ordered = sortSourcesForEvidence(project.sources);
  if (sid?.size) ordered = ordered.filter((s) => sid.has(s.id));
  const perFileMax = Math.max(2_000, Math.round(opts?.perFileMaxChars ?? 22_000));
  const query = (opts?.query ?? "").trim();

  // If no query is provided, fall back to simple sequential packing (previous behavior).
  if (!query) {
    for (const src of ordered) {
      if (budget < 2_000) break;
      if (src.parseStatus === "skipped") continue;

      const blockHead = `\n<<<BEGIN SOURCE: ${src.relPath} | category=${src.category} | status=${src.parseStatus}>>>\n`;
      const body = project.chunks
        .filter((c) => c.sourceFileId === src.id)
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((c) => c.text)
        .join("\n\n--- chunk ---\n\n");

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

  // Rank chunks by relevance to memo request, then pack breadth-first across files.
  const ranked = rankChunksByRelevance({ sources: project.sources, chunks: project.chunks, query });
  const scoreByChunkId = new Map<string, number>();
  for (const r of ranked) scoreByChunkId.set(r.chunk.id, r.score);

  const chunksBySource = new Map<string, Array<{ id: string; chunkIndex: number; text: string; score: number }>>();
  for (const c of project.chunks) {
    const sc = scoreByChunkId.get(c.id) ?? 0;
    if (!chunksBySource.has(c.sourceFileId)) chunksBySource.set(c.sourceFileId, []);
    chunksBySource.get(c.sourceFileId)!.push({ id: c.id, chunkIndex: c.chunkIndex, text: c.text, score: sc });
  }
  chunksBySource.forEach((arr) => {
    arr.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
  });

  const pickedBySource = new Map<string, string[]>(); // sourceId -> chunk ids in chosen order
  const usedCharsBySource = new Map<string, number>();
  const sourceMeta = new Map<string, SourceFileRecord>();
  for (const s of project.sources) sourceMeta.set(s.id, s);

  // Initialize candidates in the same file ordering used for evidence preference.
  const candidates = ordered
    .filter((s) => s.parseStatus !== "skipped")
    .map((s) => ({
      src: s,
      queue: (chunksBySource.get(s.id) ?? []).filter((x) => x.text.trim().length > 0),
      cursor: 0,
    }))
    .filter((x) => x.queue.length > 0);

  // Round-robin: take the next best chunk from each file, respecting per-file caps.
  let safety = 0;
  while (budget > 2_200 && candidates.length > 0 && safety++ < 200_000) {
    let progressed = false;
    for (const c of candidates) {
      if (budget < 2_200) break;
      const src = c.src;
      const used = usedCharsBySource.get(src.id) ?? 0;
      if (used >= perFileMax) continue;
      if (c.cursor >= c.queue.length) continue;

      const next = c.queue[c.cursor++];
      const remainingForFile = Math.max(0, perFileMax - used);
      const chunkText =
        next.text.length > remainingForFile
          ? `${next.text.slice(0, remainingForFile)}\n…[truncated per-file cap]`
          : next.text;
      if (!chunkText.trim()) continue;

      const begin = `\n<<<BEGIN SOURCE: ${src.relPath} | category=${src.category} | status=${src.parseStatus}>>>\n`;
      const end = `\n<<<END SOURCE: ${src.relPath}>>>\n`;

      // Only emit the source header/footer once; subsequent chunks append inside the same block.
      const alreadyStarted = pickedBySource.has(src.id);
      const prefix = alreadyStarted ? `\n--- chunk ---\n\n` : begin;

      const maxBody = Math.max(0, budget - prefix.length - (alreadyStarted ? 0 : end.length) - 40);
      if (maxBody < 250) continue;
      const clipped = chunkText.length > maxBody ? `${chunkText.slice(0, maxBody)}\n…[truncated for context budget]` : chunkText;

      if (!alreadyStarted) {
        parts.push(prefix + clipped);
      } else {
        parts.push(prefix + clipped);
      }
      budget -= prefix.length + clipped.length;
      usedCharsBySource.set(src.id, used + clipped.length);
      progressed = true;

      const list = pickedBySource.get(src.id) ?? [];
      list.push(next.id);
      pickedBySource.set(src.id, list);
    }

    // If we couldn't add anything in a full pass, stop to avoid loops.
    if (!progressed) break;
  }

  // Close any opened sources with END markers.
  pickedBySource.forEach((_ids, srcId) => {
    const s = sourceMeta.get(srcId);
    if (!s) return;
    const end = `\n<<<END SOURCE: ${s.relPath}>>>\n`;
    if (budget < end.length + 50) return;
    parts.push(end);
    budget -= end.length;
  });

  return parts.join("");
}

/** Build a short inventory list for prompts / UI */
export function formatSourceInventoryList(sources: SourceFileRecord[]): string {
  return sources
    .map((s) => `- ${s.relPath} (${s.category}, ${s.parseStatus}, ${s.charExtracted} chars)`)
    .join("\n");
}
