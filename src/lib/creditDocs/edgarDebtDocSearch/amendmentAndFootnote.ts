import type { DebtDocumentTableRow } from "@/lib/creditDocs/edgarDebtDocSearch/types";

import { normalizeDebtMatchText } from "@/lib/creditDocs/edgarDebtDocSearch/keywords";

function normalizeInstrumentKey(name: string): string {
  return normalizeDebtMatchText(name)
    .replace(/\b(first|second|third|\d+)(?:st|nd|rd|th)?\s+amendment\b/gi, "")
    .replace(/\bwaiver\b|\bconsent\b|\bjoinder\b/gi, "")
    .slice(0, 80)
    .trim();
}

/** Step 9 — Lightweight amendment sequencing (chronological within heuristic instrument bucket). */
export function buildAmendmentChain(rows: DebtDocumentTableRow[]): DebtDocumentTableRow[] {
  const sorted = [...rows].sort((a, b) => (a.filingDate || "").localeCompare(b.filingDate || ""));
  const groups = new Map<string, DebtDocumentTableRow[]>();
  for (const r of sorted) {
    const key = normalizeInstrumentKey(r.instrumentOrFacilityName || r.sourceSnippet.slice(0, 80));
    const k = key.length > 6 ? key : `${r.accessionNumber}::${r.directExhibitLink}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const out: DebtDocumentTableRow[] = [];
  for (const list of groups.values()) {
    const chron = [...list].sort((a, b) => (a.filingDate || "").localeCompare(b.filingDate || ""));
    const baseRow =
      chron.find(
        (r) =>
          !/amendment|waiver|consent|joinder|supplemental|extension|forbearance/i.test(r.documentType) &&
          !/amendment|waiver|consent|joinder/i.test(r.instrumentOrFacilityName)
      ) ?? chron[0];
    let amendN = 0;
    for (const r of chron) {
      const isAmend =
        /amendment|waiver|consent|joinder|supplemental|extension|forbearance/i.test(r.documentType) ||
        /amendment|waiver|consent|joinder/i.test(r.instrumentOrFacilityName);
      if (isAmend) amendN++;
      out.push({
        ...r,
        amendmentSequence: isAmend ? String(amendN) : "—",
        baseDocumentLink: isAmend && baseRow ? baseRow.directExhibitLink : null,
      });
    }
  }
  return out.sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
}

/** Step 10 — Heuristic cross-check vs latest 10-K debt disclosure region (no XBRL guarantee). */
export function crossCheckDebtFootnote(
  latestTenKPlain: string,
  foundRows: DebtDocumentTableRow[]
): Array<{ instrumentOrDescription: string; reason: string }> {
  const region = extractDebtFootnoteRegion(latestTenKPlain);
  const cues = extractDebtFootnoteInstrumentCues(region);
  const foundBlob = normalizeDebtMatchText(
    foundRows.map((r) => `${r.instrumentOrFacilityName} ${r.sourceSnippet}`).join(" \n ")
  );
  const missing: Array<{ instrumentOrDescription: string; reason: string }> = [];

  for (const cue of cues) {
    const n = normalizeDebtMatchText(cue);
    if (n.length < 14) continue;
    if (!foundBlob.includes(n.slice(0, Math.min(48, n.length)))) {
      missing.push({
        instrumentOrDescription: cue.slice(0, 220),
        reason:
          "Language appears in latest 10-K debt-disclosure region — no exhibit row confidently matched yet (verify manually; IBR or non-EDGAR filing possible).",
      });
    }
  }
  return missing.slice(0, 35);
}

function extractDebtFootnoteRegion(htmlOrText: string): string {
  const t = htmlOrText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const keys = /long[\s-]term debt|borrowings|credit arrangements|debt and financing|description of debt/i;
  const m = keys.exec(t);
  if (!m || m.index === undefined) return t.slice(0, 130_000);
  return t.slice(m.index, m.index + 95_000);
}

function extractDebtFootnoteInstrumentCues(region: string): string[] {
  const parts = region.split(/(?:\n|;|•)/).map((s) => s.trim());
  return parts
    .filter((s) => s.length > 14 && s.length < 260)
    .filter((s) =>
      /term\s+loan|revolv|credit\s+facility|indenture|senior\s+notes?|secured\s+notes?|convertible|debenture|ABL|facility\s+agreement/i.test(
        s
      )
    )
    .slice(0, 45);
}
