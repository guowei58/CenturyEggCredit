import type { SourceFact } from "@/lib/xbrl-ai-consolidation/sourceFacts";
import { kindFromMarkdownTitle, periodKeysCompatible } from "@/lib/xbrl-ai-consolidation/sourceFacts";
import type { StatementKind } from "@/lib/xbrl-saved-history/types";

function stripCell(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

function splitPipeRow(line: string): string[] {
  let t = line.trim();
  if (!t.startsWith("|")) return [];
  if (t.endsWith("|")) t = t.slice(0, -1);
  const inner = t.slice(1);
  return inner.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/** Financial-style markdown number: negatives as (1,234.56). */
function formatMoneyForMarkdownCell(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v < 0) return `(${s})`;
  return s;
}

function findConceptColumnIndex(header: string[]): number {
  return header.findIndex((h) => /^concept$/i.test(stripCell(h)));
}

function findLineColumnIndex(header: string[]): number {
  return header.findIndex((h) => /^line(\s+item)?$/i.test(stripCell(h)));
}

function buildFactsByConcept(facts: SourceFact[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const f of facts) {
    const ck = `${f.kind}\t${f.concept}`;
    let pm = m.get(ck);
    if (!pm) {
      pm = new Map<string, number>();
      m.set(ck, pm);
    }
    pm.set(f.periodLabel, f.value);
  }
  return m;
}

function lookupFactValue(
  byConcept: Map<string, Map<string, number>>,
  kind: StatementKind,
  concept: string,
  periodHeader: string
): number | null {
  const ck = `${kind}\t${concept}`;
  const pm = byConcept.get(ck);
  if (!pm) return null;
  for (const [pl, v] of pm) {
    if (periodKeysCompatible(pl, periodHeader)) return v;
  }
  return null;
}

function padRow(width: number, row: string[]): string[] {
  const out = row.map((c) => c);
  while (out.length < width) out.push("");
  return out;
}

function tableBlockToLines(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const w = Math.max(1, ...rows.map((r) => r.length));
  const lines: string[] = [];
  const fmt = (r: string[]) => "| " + padRow(w, r).join(" | ") + " |";
  lines.push(fmt(rows[0]!));
  lines.push("| " + Array.from({ length: w }, () => "---").join(" | ") + " |");
  for (let i = 1; i < rows.length; i++) lines.push(fmt(rows[i]!));
  return lines;
}

function repairTableRows(rows: string[][], kind: StatementKind, byConcept: Map<string, Map<string, number>>): string[][] {
  if (rows.length < 2) return rows;
  const header = rows[0]!.map((c) => stripCell(c));
  const conceptCol = findConceptColumnIndex(header);
  if (conceptCol < 0) return rows;
  const lineCol = findLineColumnIndex(header);
  const labelCols = new Set([conceptCol, lineCol].filter((i) => i >= 0));
  const periodCols: { idx: number; header: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (!labelCols.has(c)) periodCols.push({ idx: c, header: header[c] ?? "" });
  }

  const out = rows.map((r) => [...r]);
  const w = Math.max(1, ...rows.map((r) => r.length));
  for (let r = 1; r < out.length; r++) {
    const row = padRow(w, [...(out[r] ?? [])]);
    const concept = stripCell(String(row[conceptCol] ?? ""));
    if (!concept || !concept.includes(":")) continue;
    for (const { idx, header: ph } of periodCols) {
      if (!ph.trim()) continue;
      const v = lookupFactValue(byConcept, kind, concept, ph);
      if (v === null) continue;
      row[idx] = formatMoneyForMarkdownCell(v);
    }
    out[r] = row;
  }
  return out;
}

/**
 * Overwrites numeric cells in the three primary statement tables when a merged XBRL source fact exists for the same
 * statement kind, concept tag, and period column. Fixes LLM transcription drift; does not invent numbers.
 */
export function repairConsolidatedMarkdownFromSourceFacts(markdown: string, facts: SourceFact[]): string {
  if (!facts.length || !markdown.trim()) return markdown;
  const byConcept = buildFactsByConcept(facts);
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let recentHeading = "";

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const hm = line.match(/^#{1,3}\s+(.+)/);
    if (hm) {
      recentHeading = hm[1]!.trim().replace(/[#*`]/g, "");
      out.push(line);
      i++;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        block.push(lines[i]!);
        i++;
      }
      const kind = kindFromMarkdownTitle(recentHeading);
      if (!kind) {
        out.push(...block);
        continue;
      }
      const parsedRows: string[][] = [];
      for (const raw of block) {
        const cells = splitPipeRow(raw);
        if (cells.length === 0) continue;
        if (isSeparatorRow(cells)) continue;
        parsedRows.push(cells);
      }
      if (parsedRows.length === 0) {
        out.push(...block);
        continue;
      }
      const repaired = repairTableRows(parsedRows, kind, byConcept);
      out.push(...tableBlockToLines(repaired));
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join("\n");
}
