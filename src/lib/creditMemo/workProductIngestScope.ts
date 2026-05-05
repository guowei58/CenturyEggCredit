import path from "path";

import { SAVED_DATA_FILES } from "@/lib/saved-ticker-data";

import { classifySourceFilename } from "./fileClassifier";

/**
 * Which Work Product UI triggered folder ingest — used for KPI-only path rules and logging.
 * Generated tab artifacts are listed in `GENERATED_WORK_PRODUCT_ARTIFACT_BASES`; most scopes skip them,
 * while **memo** additionally allowlists KPI / Forensic / LME / Recommendation markdown (see `memoDeckRestrictedIngestKeep`).
 */
export type WorkProductIngestScope =
  | "memo"
  | "kpi"
  | "forensic"
  | "capstructure"
  | "literary"
  | "biblical"
  | "generic";

const VALID = new Set<string>(["memo", "kpi", "forensic", "capstructure", "literary", "biblical", "generic"]);

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
    "lme-analysis.md",
    "lme-analysis-meta.json",
  ].map((s) => s.toLowerCase())
);

/**
 * AI Memo & Deck folder ingest: main markdown outputs from these tabs (not meta / source-pack).
 * These stay in {@link GENERATED_WORK_PRODUCT_ARTIFACT_BASES} for other scopes but are allowed when `scope === "memo"`.
 */
const MEMO_DECK_INCLUDED_WORK_PRODUCT_BASENAMES = new Set(
  ["kpi-latest.md", "forensic-accounting-latest.md", "lme-analysis.md", "cs-recommendation-latest.md", "entity-mapper-latest.md"].map((s) =>
    s.toLowerCase()
  )
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

/** Tabs that save HTML instead of `.txt` but use the same “saved response” UI. */
const MEMO_DECK_SAVED_RESPONSE_HTML_BASENAMES = new Set(["employee-contacts.html", "industry-contacts.html"]);

/**
 * Whether a workspace-relative path is ingested for **AI Memo & Deck** (`workProductIngestScope: "memo"`).
 * Keeps: saved-tab `.txt` (and contacts `.html`), KPI / Forensic / LME / Recommendation markdown outputs,
 * and files classified as SEC filings or presentations (`fileClassifier.ts`), plus common SEC EDGAR
 * `dex10…` exhibit basenames when the classifier returns `other`.
 */
export function memoDeckRestrictedIngestKeep(relPath: string): boolean {
  const base = path.basename(relPath.replace(/\\/g, "/")).toLowerCase();

  if (MEMO_DECK_INCLUDED_WORK_PRODUCT_BASENAMES.has(base)) return true;
  if (MEMO_DECK_SAVED_RESPONSE_TXT_BASENAMES.has(base)) return true;
  if (MEMO_DECK_SAVED_RESPONSE_HTML_BASENAMES.has(base)) return true;

  const cat = classifySourceFilename(relPath);
  if (cat === "sec_filing" || cat === "presentation") return true;
  // SEC EDGAR material-contract exhibits often appear as `dex101`…`dex1012` glued to accession digits in the basename.
  if (/dex10\d{1,4}/i.test(base)) return true;
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
  scope: WorkProductIngestScope
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
    if (/^ai-credit-memo-.+\.md$/i.test(base)) {
      return {
        skip: true,
        parseNote:
          "Excluded: generated credit memo markdown from this workspace (saved AI Memo output—not ingested as research).",
      };
    }
    if (memoDeckRestrictedIngestKeep(relPath)) {
      return { skip: false };
    }
    return {
      skip: true,
      parseNote:
        "Excluded for AI Memo & Deck ingest: only saved tab .txt (plus employee/industry contacts .html), KPI / Forensic / LME / Recommendation markdown outputs, SEC filings (including common `dex10…` exhibit filenames), and presentation-class files (by filename/path heuristics) are included.",
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
