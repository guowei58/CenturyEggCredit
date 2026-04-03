/**
 * Server-only: aggregate covenant-relevant text saved under Credit Agreements & Indentures
 * plus optional workspace notes. Used by /api/covenants.
 */

import path from "path";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import { listCreditAgreementsFiles } from "@/lib/credit-agreements-files";
import { workspaceReadFile } from "@/lib/user-ticker-workspace-store";

export type CovenantSourcePart = {
  label: string;
  key?: string;
  file?: string;
  content: string;
  truncated: boolean;
};

/** Saved responses from the Credit Agreements & Indentures tab (+ legacy single file). */
export const CREDIT_AGREEMENTS_SAVED_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "credit-agreements-indentures-other", label: "Credit Agreements — Document list" },
  { key: "credit-agreements-indentures-credit-agreement", label: "Credit Agreements — Credit agreement" },
  { key: "credit-agreements-indentures-first-lien-indenture", label: "Credit Agreements — 1st lien indenture" },
  { key: "credit-agreements-indentures-second-lien-indenture", label: "Credit Agreements — 2nd lien indenture" },
  { key: "credit-agreements-indentures-unsecured", label: "Credit Agreements — Unsecured" },
  { key: "credit-agreements-indentures", label: "Credit Agreements — Legacy save (pre-split)" },
];

/** Supplementary text that often holds covenant excerpts or trade context. */
const SUPPLEMENTAL_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "notes-thoughts", label: "Work Product — Notes & Thoughts" },
  { key: "capital-structure", label: "Capital Structure — Saved response" },
];

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv"]);

const DEFAULT_MAX_PART_CHARS = 120_000;
const DEFAULT_MAX_TOTAL_CHARS = 380_000;

export type GatherCovenantLimits = {
  maxPartChars?: number;
  maxTotalChars?: number;
};

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return {
    text: `${s.slice(0, max)}\n\n…[truncated — source exceeded ${max.toLocaleString()} characters]`,
    truncated: true,
  };
}

async function readUploadIfText(
  userId: string,
  ticker: string,
  storageName: string,
  originalName: string
): Promise<string | null> {
  const ext = path.extname(originalName || storageName || "").toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return null;
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  const rel = `Credit Agreements & Indentures/${storageName}`;
  try {
    const buf = await workspaceReadFile(userId, sym, rel);
    if (!buf) return null;
    const text = buf.toString("utf8");
    return text.trim().length ? text : "";
  } catch {
    return null;
  }
}

export async function gatherCovenantSources(
  ticker: string,
  limits?: GatherCovenantLimits,
  userId?: string | null
): Promise<{
  parts: CovenantSourcePart[];
  totalChars: number;
  nonEmptyCount: number;
  hasSubstantiveText: boolean;
}> {
  const maxPartChars = limits?.maxPartChars ?? DEFAULT_MAX_PART_CHARS;
  const maxTotalChars = limits?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const parts: CovenantSourcePart[] = [];

  for (const { key, label } of CREDIT_AGREEMENTS_SAVED_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    const { text, truncated } = truncate(raw, maxPartChars);
    parts.push({ label, key, content: text, truncated });
  }

  for (const { key, label } of SUPPLEMENTAL_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    const { text, truncated } = truncate(raw, maxPartChars);
    parts.push({ label, key, content: text, truncated });
  }

  if (userId) {
    const uploads = await listCreditAgreementsFiles(userId, ticker);
    if (uploads) {
      for (const u of uploads) {
        const raw = await readUploadIfText(userId, ticker, u.filename, u.originalName);
        if (raw === null) {
          parts.push({
            label: `Credit Agreements — Uploaded file (${u.originalName})`,
            file: u.filename,
            content: `[Binary or non-text upload — not auto-ingested. Open Credit Agreements & Indentures → Debt documents to download.]\n`,
            truncated: false,
          });
          continue;
        }
        if (!raw.trim()) continue;
        const { text, truncated } = truncate(raw, maxPartChars);
        parts.push({
          label: `Credit Agreements — Uploaded: ${u.originalName}`,
          file: u.filename,
          content: text,
          truncated,
        });
      }
    }
  }

  let total = 0;
  let nonEmpty = 0;
  for (const p of parts) {
    const n = p.content.length;
    if (n > 0 && !p.content.startsWith("[Binary")) nonEmpty++;
    total += n;
  }

  let combined = parts;
  if (total > maxTotalChars) {
    const trimmed: CovenantSourcePart[] = [];
    let acc = 0;
    for (const p of parts) {
      const room = maxTotalChars - acc;
      if (room <= 0) break;
      const slice = p.content.length > room ? `${p.content.slice(0, room)}\n\n…[truncated for covenant bundle size limit]` : p.content;
      trimmed.push({ ...p, content: slice, truncated: p.truncated || p.content.length > room });
      acc += slice.length;
    }
    combined = trimmed;
  }

  const nonEmptyCount = combined.filter((p) => p.content.trim().length > 0 && !p.content.startsWith("[Binary")).length;
  const hasSubstantiveText = combined.some(
    (p) => p.content.trim().length > 40 && !p.content.startsWith("[Binary")
  );

  return {
    parts: combined,
    totalChars: combined.reduce((s, p) => s + p.content.length, 0),
    nonEmptyCount,
    hasSubstantiveText,
  };
}

export function formatSourcesForClaude(ticker: string, parts: CovenantSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header = `Ticker: ${sym}\nBelow are source excerpts from saved Credit Agreements & Indentures content (and supplementary notes). Use them as the sole factual basis for covenant synthesis.\n\n`;
  const blocks = parts.map(
    (p) =>
      `==========\nSOURCE: ${p.label}${p.key ? ` [key:${p.key}]` : ""}${p.file ? ` [file:${p.file}]` : ""}\n==========\n${p.content}\n`
  );
  return header + blocks.join("\n");
}

export function sourcesFingerprint(parts: CovenantSourcePart[]): string {
  return parts
    .map((p) => `${p.label}:${p.content.length}:${hashShort(p.content)}`)
    .join("|");
}

function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
