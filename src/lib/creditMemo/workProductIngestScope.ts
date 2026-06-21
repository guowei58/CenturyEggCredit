import path from "path";

import { SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import {
  isPeriodFinancialsEarningsTranscriptFilename,
  isPeriodFinancialsMgmtPresentationFilename,
} from "@/lib/kpi-workspace-sources";
import { filterPeriodFinancialsPathsToLastNQuarters } from "@/lib/period-financials-ingest-filter";

/**
 * Which Work Product UI triggered folder ingest — used for KPI-only path rules and logging.
 * Generated tab artifacts are listed in `GENERATED_WORK_PRODUCT_ARTIFACT_BASES`; most scopes skip them,
 * while **memo** allowlists KPI / Forensic / LME / Recommendation markdown plus saved tabs, latest 10-K,
 * and Period Financials presentations/transcripts from the last four quarters (see `buildMemoDeckIngestAllowSet`).
 */
export type WorkProductIngestScope =
  | "memo"
  | "kpi"
  | "forensic"
  | "capstructure"
  | "literary"
  | "biblical"
  | "dumbass"
  | "earnings-transcript"
  | "credit-dashboard"
  | "generic";

const VALID = new Set<string>([
  "memo",
  "kpi",
  "forensic",
  "capstructure",
  "literary",
  "biblical",
  "dumbass",
  "earnings-transcript",
  "credit-dashboard",
  "generic",
]);

export function normalizeWorkProductIngestScope(raw: unknown): WorkProductIngestScope {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (VALID.has(s)) return s as WorkProductIngestScope;
  return "memo";
}

/** Workspace tree for Memo & deck library (.md / .pptx / index); not research inputs. */
export const MEMO_DECK_LIBRARY_PATH_PREFIX = "ai-memo-deck-library/";

/** True for paths under the memo/deck library export tree (KPI, forensic, etc. must not treat as research). */
export function isMemoDeckLibraryWorkspacePath(relPath: string): boolean {
  const n = relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return n.startsWith(MEMO_DECK_LIBRARY_PATH_PREFIX);
}

/**
 * Basenames of saved workspace artifacts from generated tabs (any scope).
 * These are never research inputs — exclude from memo, forensic, KPI ingest, etc.
 */
const GENERATED_WORK_PRODUCT_ARTIFACT_BASES = new Set(
  [
    "ai-credit-memo-latest.md",
    "ai-credit-memo-latest-meta.json",
    "ai-credit-memo-latest-source-pack.txt",
    "kpi-latest.md",
    "kpi-latest-meta.json",
    "kpi-latest-source-pack.txt",
    "forensic-accounting-latest.md",
    "forensic-accounting-latest-meta.json",
    "forensic-accounting-latest-source-pack.txt",
    "cs-recommendation-latest.md",
    "cs-recommendation-latest-meta.json",
    "cs-recommendation-latest-source-pack.txt",
    "entity-mapper-latest.md",
    "entity-mapper-latest-meta.json",
    "literary-references-latest.md",
    "literary-references-latest-meta.json",
    "literary-references-latest-source-pack.txt",
    "biblical-references-latest.md",
    "biblical-references-latest-meta.json",
    "biblical-references-latest-source-pack.txt",
    "how-to-look-like-a-dumbass-latest.md",
    "how-to-look-like-a-dumbass-latest-meta.json",
    "how-to-look-like-a-dumbass-latest-source-pack.txt",
    "next-quarter-earnings-transcript-latest.md",
    "next-quarter-earnings-transcript-latest-meta.json",
    "next-quarter-earnings-transcript-latest-source-pack.txt",
    "credit-decision-dashboard-latest.json",
    "credit-decision-dashboard-latest-meta.json",
    "credit-decision-dashboard-latest-source-pack.txt",
    "credit-decision-dashboard-inputs.json",
    "lme-analysis.md",
    "lme-analysis-meta.json",
  ].map((s) => s.toLowerCase())
);

/**
 * AI Memo & Deck folder ingest: main markdown outputs from these tabs (not meta / source-pack).
 * These stay in {@link GENERATED_WORK_PRODUCT_ARTIFACT_BASES} for other scopes but are allowed when `scope === "memo"`.
 */
const MEMO_DECK_INCLUDED_WORK_PRODUCT_BASENAMES = new Set(
  [
    "kpi-latest.md",
    "forensic-accounting-latest.md",
    "lme-analysis.md",
    "cs-recommendation-latest.md",
    "xbrl-consolidated-financials-ai.md",
  ].map((s) => s.toLowerCase())
);

/** Saved-tab `.txt` keys (materialized filenames) for memo ingest — excludes deck text and source packs. */
function buildMemoDeckSavedResponseTxtBasenames(): Set<string> {
  const s = new Set<string>();
  for (const fn of Object.values(SAVED_DATA_FILES)) {
    const lower = fn.toLowerCase();
    if (!lower.endsWith(".txt")) continue;
    if (lower === "ai-credit-deck.txt") continue;
    if (lower.endsWith("-source-pack.txt")) continue;
    s.add(lower);
  }
  return s;
}

const MEMO_DECK_SAVED_RESPONSE_TXT_BASENAMES = buildMemoDeckSavedResponseTxtBasenames();

function normalizeWorkspaceRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function looksLikeTenKFilename(filename: string): boolean {
  const base = path.basename(filename.replace(/\\/g, "/"));
  return /(^|[_\s-])10-?k([_\s.-]|$)/i.test(base);
}

export function looksLikeTenQFilename(filename: string): boolean {
  const base = path.basename(filename.replace(/\\/g, "/"));
  return /(^|[_\s-])10-?q([_\s.-]|$)/i.test(base);
}

function extractSecFilingSortKey(filename: string): number {
  const base = path.basename(filename.replace(/\\/g, "/")).toLowerCase();
  const yearMatch = /(?:10-?k|10-?q)[^0-9]{0,8}(\d{4})/i.exec(base) ?? /(\d{4})/.exec(base);
  const year = yearMatch ? Number(yearMatch[1]) : 0;
  const quarterMatch = /(?:q|quarter[_-]?)([1-4])/i.exec(base);
  const quarter = quarterMatch ? Number(quarterMatch[1]) : 0;
  return year * 10 + quarter;
}

function pickLatestSecFilingPath(candidates: string[], kind: "10-K" | "10-Q"): string | null {
  const filtered = candidates.filter((rel) =>
    kind === "10-K" ? looksLikeTenKFilename(rel) : looksLikeTenQFilename(rel)
  );
  if (filtered.length === 0) return null;
  return [...filtered].sort((a, b) => extractSecFilingSortKey(b) - extractSecFilingSortKey(a))[0] ?? null;
}

function isMemoDeckWorkProductMarkdown(relPath: string): boolean {
  const base = path.basename(relPath.replace(/\\/g, "/")).toLowerCase();
  return MEMO_DECK_INCLUDED_WORK_PRODUCT_BASENAMES.has(base);
}

/** Higher = earlier in AI Memo & Deck sequential evidence packs. */
export function memoDeckEvidenceSourcePriority(relPath: string): number {
  const base = path.basename(relPath.replace(/\\/g, "/")).toLowerCase();
  if (MEMO_DECK_INCLUDED_WORK_PRODUCT_BASENAMES.has(base)) return 100;
  if (isPeriodFinancialsMgmtPresentationFilename(base) || isPeriodFinancialsEarningsTranscriptFilename(base)) return 85;
  if (MEMO_DECK_SAVED_RESPONSE_TXT_BASENAMES.has(base)) return 75;
  if (looksLikeTenKFilename(relPath)) return 60;
  return 50;
}

function isMemoDeckSavedTabResponse(relPath: string): boolean {
  const base = path.basename(relPath.replace(/\\/g, "/")).toLowerCase();
  return MEMO_DECK_SAVED_RESPONSE_TXT_BASENAMES.has(base);
}

function isMemoDeckPeriodFinancialsSource(relPath: string): boolean {
  const base = path.basename(relPath.replace(/\\/g, "/"));
  return (
    isPeriodFinancialsMgmtPresentationFilename(base) || isPeriodFinancialsEarningsTranscriptFilename(base)
  );
}

/**
 * AI Memo & Deck ingest allowlist built from the full materialized workspace file list.
 * Includes: KPI / Forensic / LME / Recommendation outputs, saved-tab `.txt` responses,
 * latest 10-K only, and Period Financials management presentations + earnings transcripts
 * from the last four fiscal quarters.
 */
export function buildMemoDeckIngestAllowSet(allRelPaths: string[]): Set<string> {
  const allowed = new Set<string>();
  const secCandidates: string[] = [];
  const periodFinancialsCandidates: string[] = [];

  for (const rel of allRelPaths) {
    const norm = normalizeWorkspaceRelPath(rel);
    if (isMemoDeckWorkProductMarkdown(rel)) {
      allowed.add(norm);
      continue;
    }
    if (isMemoDeckSavedTabResponse(rel)) {
      allowed.add(norm);
      continue;
    }
    if (isMemoDeckPeriodFinancialsSource(rel)) {
      periodFinancialsCandidates.push(rel);
      continue;
    }
    if (looksLikeTenKFilename(rel)) {
      secCandidates.push(rel);
    }
  }

  for (const norm of filterPeriodFinancialsPathsToLastNQuarters(periodFinancialsCandidates)) {
    allowed.add(norm);
  }

  const latestTenK = pickLatestSecFilingPath(secCandidates, "10-K");
  if (latestTenK) allowed.add(normalizeWorkspaceRelPath(latestTenK));

  return allowed;
}

/**
 * Whether a workspace-relative path is ingested for **AI Memo & Deck** (`workProductIngestScope: "memo"`).
 * Prefer {@link buildMemoDeckIngestAllowSet} during folder ingest so latest 10-K / 10-Q can be resolved globally.
 */
export function memoDeckRestrictedIngestKeep(relPath: string): boolean {
  if (isMemoDeckWorkProductMarkdown(relPath)) return true;
  if (isMemoDeckSavedTabResponse(relPath)) return true;
  if (isMemoDeckPeriodFinancialsSource(relPath)) return true;
  return false;
}

/**
 * KPI ingest: exclude raw legal debt documents by basename heuristics (any folder — including
 * `__ceg_user_saved_documents__/` SEC HTML uploads). Not perfect, but catches EDGAR names like
 * `...dex101...` (no word boundary before `dex`) and `...indenture...`.
 */
export function kpiFilenameSuggestsCreditAgreementOrIndenture(baseLower: string): boolean {
  const b = baseLower.trim().toLowerCase();
  if (!b) return false;
  if (b.includes("indenture") || b.includes("debenture")) return true;
  if (b.includes("credit-agreement") || b.includes("credit_agreement")) return true;
  if (b.includes("credit") && b.includes("agreement")) return true;
  if (b.includes("loan") && b.includes("agreement")) return true;
  if (b.includes("revolving") && (b.includes("credit") || b.includes("loan") || b.includes("facility"))) return true;
  if (b.includes("credit facility") || b.includes("term loan") || b.includes("term-loan")) return true;
  // SEC EDGAR material contracts: exhibit 10.x often appears as dex101 (=10.1), dex102, … (may be glued to accession digits).
  if (/dex10\d{1,4}/i.test(b)) return true;
  // Saved SEC HTML exhibits: a{accession}exhibit403.html and similar material-contract filenames.
  if (/a\d+exhibit\d+/i.test(b)) return true;
  if (b.includes("exhibit") && (/\b403\b/.test(b) || b.includes("10.1") || b.includes("101"))) return true;
  return false;
}

/** KPI commentary: skip legal/cap-structure corpus; see CompanyKpiTab source-inventory footnote. */
function kpiOnlyWorkspaceSkip(normalizedRel: string, baseLower: string): { skip: boolean; parseNote: string } | null {
  if (normalizedRel.includes("credit agreements & indentures/")) {
    return {
      skip: true,
      parseNote: "Excluded for KPI commentary: Credit Agreements & Indentures uploads and manifest.",
    };
  }
  if (normalizedRel.includes("capital structure excel/")) {
    return {
      skip: true,
      parseNote: "Excluded for KPI commentary: Capital Structure Excel tree.",
    };
  }

  const exact = new Set([
    "xbrl-deterministic-compiler-result.json",
    "xbrl-consolidated-financials-ai.md",
    "historical-financials-prompt.txt",
    "capital-structure.txt",
    "covenants-synthesis.md",
    "covenants-synthesis-meta.json",
    "credit-agreements-files.json",
    "capital-structure-excel.json",
  ]);
  if (exact.has(baseLower)) {
    return {
      skip: true,
      parseNote: "Excluded for KPI commentary: financial model, capital structure, or credit-agreement saves.",
    };
  }
  if (baseLower.startsWith("credit-agreements-indentures")) {
    return {
      skip: true,
      parseNote: "Excluded for KPI commentary: credit agreements / indentures tab text.",
    };
  }
  if (kpiFilenameSuggestsCreditAgreementOrIndenture(baseLower)) {
    return {
      skip: true,
      parseNote:
        "Excluded for KPI commentary: filename looks like a credit agreement, indenture, or SEC exhibit 10.x debt instrument (heuristic).",
    };
  }
  return null;
}

/**
 * Returns whether a materialized workspace path should be skipped for ingest, and an optional parse note.
 */
export function workspaceFileSkippedForWorkProductIngest(
  relPath: string,
  scope: WorkProductIngestScope,
  opts?: { memoDeckAllowSet?: Set<string> }
): { skip: boolean; parseNote?: string } {
  const n = relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const base = path.basename(n);

  /** App-internal saved paths (LME/KPI embedding JSON, templates, memo state) — never research inputs. */
  if (n.startsWith("credit-memo/") || n === "credit-memo") {
    return {
      skip: true,
      parseNote:
        "Excluded: credit-memo/ tree (embedding caches, templates, job state, etc.—not ingested as research).",
    };
  }

  if (isMemoDeckLibraryWorkspacePath(relPath)) {
    return {
      skip: true,
      parseNote: "Excluded: memo/deck library export tree (not ingested as research).",
    };
  }

  if (base === "ai-credit-deck.txt") {
    return {
      skip: true,
      parseNote: "Excluded: generated credit deck text (not ingested as source).",
    };
  }

  if (GENERATED_WORK_PRODUCT_ARTIFACT_BASES.has(base)) {
    const memoAllowsThisArtifact =
      (scope === "memo" || scope === "generic") && MEMO_DECK_INCLUDED_WORK_PRODUCT_BASENAMES.has(base);
    if (!memoAllowsThisArtifact) {
      return {
        skip: true,
        parseNote: "Excluded: generated work-product output saved to the workspace (not ingested as research).",
      };
    }
  }

  const effective = scope === "generic" ? "memo" : scope;

  if (effective === "memo") {
    if (opts?.memoDeckAllowSet) {
      const norm = normalizeWorkspaceRelPath(relPath);
      if (opts.memoDeckAllowSet.has(norm)) {
        return { skip: false };
      }
    }
    if (/^ai-credit-memo-.+\.md$/i.test(base)) {
      return {
        skip: true,
        parseNote:
          "Excluded: generated credit memo markdown from this workspace (saved AI Memo output—not ingested as research).",
      };
    }
    if (opts?.memoDeckAllowSet) {
      return {
        skip: true,
        parseNote:
          "Excluded for AI Memo & Deck ingest: only KPI / Forensic / LME / Recommendation outputs, saved tab .txt responses, latest 10-K, Period Financials management presentations and earnings transcripts from the last four quarters, and any sources you add under Extra ingestion sources are included.",
      };
    }
    if (memoDeckRestrictedIngestKeep(relPath)) {
      return { skip: false };
    }
    return {
      skip: true,
      parseNote:
        "Excluded for AI Memo & Deck ingest: only KPI / Forensic / LME / Recommendation outputs, saved tab .txt responses, latest 10-K, and Period Financials management presentations and earnings transcripts from the last four quarters are included.",
    };
  }

  if (effective === "kpi") {
    const kpi = kpiOnlyWorkspaceSkip(n, base);
    if (kpi) return kpi;
  }

  if (effective === "forensic") {
    if (/^ai-credit-memo-.+\.md$/i.test(base)) {
      return {
        skip: true,
        parseNote:
          "Excluded: generated AI credit memo markdown from this workspace (saved AI Memo output—not ingested as research).",
      };
    }
    return { skip: false };
  }

  return { skip: false };
}
