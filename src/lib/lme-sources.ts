/**
 * Aggregate Capital Structure section sources for LME analysis (saved text + Excel + credit docs).
 */

import path from "path";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import { CREDIT_AGREEMENTS_SAVED_KEYS } from "@/lib/covenant-sources";
import { listCreditAgreementsFiles } from "@/lib/credit-agreements-files";
import { workspaceReadFile } from "@/lib/user-ticker-workspace-store";
import { listCapitalStructureExcels, getCapitalStructureExcelBuffer } from "@/lib/capital-structure-excel";
import { listOrgChartExcels, getOrgChartExcelBuffer } from "@/lib/org-chart-excel";
import { listSubsidiaryListExcels, getSubsidiaryListExcelBuffer } from "@/lib/subsidiary-list-excel";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";

export type LmeSourcePart = {
  label: string;
  key?: string;
  file?: string;
  content: string;
  truncated: boolean;
};

const CAPITAL_STRUCTURE_TEXT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "capital-structure", label: "Capital Structure — Saved response" },
];

const ORG_CHART_TEXT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "org-chart-prompt", label: "Org Chart — Saved response" },
];

const SUBSIDIARY_LIST_TEXT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "subsidiary-list", label: "Subsidiary List — Saved response" },
];

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv"]);

const DEFAULT_MAX_PART_CHARS = 140_000;
const DEFAULT_MAX_TOTAL_CHARS = 520_000;

export type GatherLmeLimits = {
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

async function readCreditUploadIfText(
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

function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function lmeSourcesFingerprint(parts: LmeSourcePart[]): string {
  return parts.map((p) => `${p.label}:${p.content.length}:${hashShort(p.content)}`).join("|");
}

export function formatSourcesForLme(ticker: string, parts: LmeSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header = `Ticker: ${sym}\nThe blocks below are saved work from the Capital Structure section (capital structure, org chart, subsidiary list, credit agreements/indentures, and related uploads). Use them as the primary factual basis.\n\n`;
  const blocks = parts.map(
    (p) =>
      `==========\nSOURCE: ${p.label}${p.key ? ` [key:${p.key}]` : ""}${p.file ? ` [file:${p.file}]` : ""}\n==========\n${p.content}\n`
  );
  return header + blocks.join("\n");
}

export async function gatherLmeSources(
  ticker: string,
  limits?: GatherLmeLimits,
  userId?: string | null
): Promise<{
  parts: LmeSourcePart[];
  totalChars: number;
  nonEmptyCount: number;
  hasSubstantiveText: boolean;
}> {
  const maxPartChars = limits?.maxPartChars ?? DEFAULT_MAX_PART_CHARS;
  const maxTotalChars = limits?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const parts: LmeSourcePart[] = [];

  for (const { key, label } of CAPITAL_STRUCTURE_TEXT_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    const { text, truncated } = truncate(raw, maxPartChars);
    parts.push({ label, key, content: text, truncated });
  }

  if (userId) {
    const sym = sanitizeTicker(ticker);
    if (sym) {
      const csItems = await listCapitalStructureExcels(userId, sym);
      if (csItems) {
        for (const it of csItems) {
          const buf = await getCapitalStructureExcelBuffer(userId, sym, it.filename);
          if (!buf?.length) continue;
          const name = it.originalName?.toLowerCase().endsWith(".xlsx") ? it.originalName : `${it.originalName || "file"}.xlsx`;
          const extracted = await extractBytesForAi(name, buf);
          const { text, truncated } = truncate(extracted, maxPartChars);
          parts.push({
            label: `Capital Structure — Excel: ${it.originalName}`,
            file: it.filename,
            content: text,
            truncated,
          });
        }
      }
    }
  }

  for (const { key, label } of ORG_CHART_TEXT_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    const { text, truncated } = truncate(raw, maxPartChars);
    parts.push({ label, key, content: text, truncated });
  }

  if (userId) {
    const sym = sanitizeTicker(ticker);
    if (sym) {
      const ocItems = await listOrgChartExcels(userId, sym);
      if (ocItems) {
        for (const it of ocItems) {
          const buf = await getOrgChartExcelBuffer(userId, sym, it.filename);
          if (!buf?.length) continue;
          const name = it.originalName?.toLowerCase().endsWith(".xlsx") ? it.originalName : `${it.originalName || "file"}.xlsx`;
          const extracted = await extractBytesForAi(name, buf);
          const { text, truncated } = truncate(extracted, maxPartChars);
          parts.push({
            label: `Org Chart — Excel: ${it.originalName}`,
            file: it.filename,
            content: text,
            truncated,
          });
        }
      }
    }
  }

  for (const { key, label } of CREDIT_AGREEMENTS_SAVED_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    const { text, truncated } = truncate(raw, maxPartChars);
    parts.push({ label, key, content: text, truncated });
  }

  if (userId) {
    const uploads = await listCreditAgreementsFiles(userId, ticker);
    if (uploads) {
      for (const u of uploads) {
        const raw = await readCreditUploadIfText(userId, ticker, u.filename, u.originalName);
        if (raw === null) {
          parts.push({
            label: `Credit Agreements — Uploaded file (${u.originalName})`,
            file: u.filename,
            content:
              "[Binary or non-text upload — not auto-ingested. Open Credit Agreements & Indentures → Debt documents to download.]\n",
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

  for (const { key, label } of SUBSIDIARY_LIST_TEXT_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    const { text, truncated } = truncate(raw, maxPartChars);
    parts.push({ label, key, content: text, truncated });
  }

  if (userId) {
    const sym = sanitizeTicker(ticker);
    if (sym) {
      const subItems = await listSubsidiaryListExcels(userId, sym);
      if (subItems) {
        for (const it of subItems) {
          const buf = await getSubsidiaryListExcelBuffer(userId, sym, it.filename);
          if (!buf?.length) continue;
          const name = it.originalName?.toLowerCase().endsWith(".xlsx") ? it.originalName : `${it.originalName || "file"}.xlsx`;
          const extracted = await extractBytesForAi(name, buf);
          const { text, truncated } = truncate(extracted, maxPartChars);
          parts.push({
            label: `Subsidiary List — Excel: ${it.originalName}`,
            file: it.filename,
            content: text,
            truncated,
          });
        }
      }
    }
  }

  let combined = parts;
  const total = combined.reduce((s, p) => s + p.content.length, 0);
  if (total > maxTotalChars) {
    const trimmed: LmeSourcePart[] = [];
    let acc = 0;
    for (const p of combined) {
      const room = maxTotalChars - acc;
      if (room <= 0) break;
      const slice =
        p.content.length > room ? `${p.content.slice(0, room)}\n\n…[truncated for LME bundle size limit]` : p.content;
      trimmed.push({ ...p, content: slice, truncated: p.truncated || p.content.length > room });
      acc += slice.length;
    }
    combined = trimmed;
  }

  const nonEmptyCount = combined.filter(
    (p) => p.content.trim().length > 0 && !p.content.startsWith("[Binary")
  ).length;
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
