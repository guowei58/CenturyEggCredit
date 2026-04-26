import { loadCreditMemoConfig } from "./config";
import { sortSourcesForEvidence } from "./memoPlanner";
import type { CreditMemoProject, SourceFileRecord } from "./types";

/**
 * Build capped evidence string with clear source boundaries for the LLM.
 *
 * Packing is **sequential only**: `sortSourcesForEvidence` order, then chunk index order within each
 * file, until the global `maxChars` budget is exhausted. Earlier sources get priority.
 *
 * `query` and `perFileMaxChars` in opts are ignored for now (previously: relevance + round-robin).
 * Reintroduce limits/strategies incrementally as needed.
 */
export function buildEvidencePackSync(
  project: CreditMemoProject,
  opts?: { maxChars?: number; query?: string; perFileMaxChars?: number; sourceIds?: Set<string> }
): string {
  const cfg = loadCreditMemoConfig();
  let budget = Math.round(opts?.maxChars ?? cfg.maxContextChars);
  const parts: string[] = [];

  const sid = opts?.sourceIds;
  const sourceCount = sid?.size ? project.sources.filter((s) => sid.has(s.id)).length : project.sources.length;
  const header = `# SOURCE PACK\nTicker: ${project.ticker}\nFolder: ${project.resolvedFolderPath}\nFiles ingested: ${sourceCount}\n\n`;
  budget -= header.length;
  parts.push(header);

  const ordered = sid?.size ? sortSourcesForEvidence(project.sources).filter((s) => sid.has(s.id)) : sortSourcesForEvidence(project.sources);

  for (const src of ordered) {
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

/** Build a short inventory list for prompts / UI */
export function formatSourceInventoryList(sources: SourceFileRecord[]): string {
  return sources
    .map((s) => `- ${s.relPath} (${s.category}, ${s.parseStatus}, ${s.charExtracted} chars)`)
    .join("\n");
}
