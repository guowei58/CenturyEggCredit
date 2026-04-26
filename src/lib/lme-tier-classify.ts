/**
 * Filename heuristics for LME priority tiering (SEC, transcripts, decks, debt instruments).
 */

import path from "path";

import { kpiFilenameSuggestsCreditAgreementOrIndenture } from "@/lib/creditMemo/workProductIngestScope";

export type LmeTier = 0 | 1 | 2 | 3 | 4;

export function basenameLower(filename: string): string {
  return path.basename(filename.trim()).toLowerCase();
}

/** SEC-style filings (HTML/PDF naming) and related. */
export function lmeFilenameSuggestsSecFiling(baseLower: string): boolean {
  const b = baseLower.trim();
  if (!b) return false;
  if (/dex10\d/i.test(b)) return true;
  if (/\b10[-_]?k\b/i.test(b) || /\b10[-_]?q\b/i.test(b) || /\b8[-_]?k\b/i.test(b)) return true;
  if (b.includes("424b") || b.includes("424-b") || b.includes("s-3") || b.includes("s3asr") || b.includes("fwplink")) return true;
  if (b.includes("def14a") || b.includes("defa14a") || b.includes("pre14a")) return true;
  if (b.includes("exhibit") && (b.includes("10.") || b.includes("99.") || b.includes("4."))) return true;
  if (b.includes("edgar") || b.includes("sec.gov")) return true;
  return false;
}

export function lmeFilenameSuggestsEarningsTranscript(baseLower: string): boolean {
  const b = baseLower.trim();
  if (!b) return false;
  if (b.includes("transcript")) return true;
  if (b.includes("earnings") && (b.includes("call") || b.includes("webcast") || b.includes("release"))) return true;
  if (b.includes("prepared") && b.includes("remarks")) return true;
  if (b.includes("q&a") || b.includes("question and answer")) return true;
  return false;
}

export function lmeFilenameSuggestsMgmtPresentation(baseLower: string): boolean {
  const b = baseLower.trim();
  if (!b) return false;
  if (b.includes("investor") && (b.includes("day") || b.includes("presentation") || b.includes("deck"))) return true;
  if (b.includes("non-deal") || b.includes("nondeal") || b.includes("roadshow")) return true;
  if (b.includes("management") && b.includes("presentation")) return true;
  if (b.includes("analyst") && (b.includes("meeting") || b.includes("day"))) return true;
  if (b.includes("slide") && (b.includes("deck") || b.includes("presentation"))) return true;
  return false;
}

/**
 * Tier for a Saved Document or generic upload by filename.
 * Debt-instrument names (KPI-exclusion heuristic) rank as T2 for LME.
 */
export function tierForSavedOrUploadFilename(filename: string): LmeTier {
  const b = basenameLower(filename);
  if (!b) return 3;
  if (kpiFilenameSuggestsCreditAgreementOrIndenture(b)) return 2;
  if (lmeFilenameSuggestsSecFiling(b) || lmeFilenameSuggestsEarningsTranscript(b) || lmeFilenameSuggestsMgmtPresentation(b)) {
    return 2;
  }
  return 3;
}

/** Tier for extracted body: boilerplate-only binaries stay T4. */
export function tierForExtractedBody(filename: string, extracted: string): LmeTier {
  const t = tierForSavedOrUploadFilename(filename);
  const e = extracted.trim();
  if (e.startsWith("[Binary") || e.startsWith("[Image") || e.startsWith("[Audio") || e.startsWith("[Video")) {
    return 4;
  }
  return t;
}
