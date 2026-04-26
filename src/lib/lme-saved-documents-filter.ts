/**
 * LME only includes Saved Documents that would be eligible under the same work-product rules as
 * Capital Structure recommendation ingest (`capstructure` scope), plus a stricter topic gate so
 * generic press/news HTML in `__ceg_user_saved_documents__/` is not packed into the LME corpus.
 */

import path from "path";

import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { classifySourceFilename } from "@/lib/creditMemo/fileClassifier";
import { kpiFilenameSuggestsCreditAgreementOrIndenture, workspaceFileSkippedForWorkProductIngest } from "@/lib/creditMemo/workProductIngestScope";
import { USER_SAVED_DOCUMENTS_MATERIALIZE_DIR } from "@/lib/user-ticker-workspace-store";

/** Keep in sync with `WORK_PRODUCT_EXCLUDED_EXCEL_EXT` in `creditMemo/folderIngest.ts`. */
const WORK_PRODUCT_EXCLUDED_EXCEL_EXT = new Set([".xlsx", ".xls", ".xlsm", ".xlsb", ".xls"]);

export function materializedSavedDocumentRelPath(filename: string): string {
  const fn = filename.trim();
  return `${USER_SAVED_DOCUMENTS_MATERIALIZE_DIR}/${fn}`.replace(/\\/g, "/");
}

function otherFilenameLooksLikeSecOrDebtDoc(baseLower: string): boolean {
  const b = baseLower.trim();
  if (!b) return false;
  if (/\b(?:^|[^a-z])10[\s-]?[kq](?:[^a-z]|$)/i.test(b)) return true;
  if (/\b8[\s-]?k\b/i.test(b)) return true;
  if (/\b424b\d?\b/i.test(b)) return true;
  if (/\b(?:s-1|s-4|f-1)\b/i.test(b)) return true;
  if (/\b(?:def\s*14a|20-f|40-f)\b/i.test(b)) return true;
  if (/\b(?:ex-10|ex10|exhibit\s*10|material\s*contract)\b/i.test(b)) return true;
  if (/\bdex10\d{1,4}\b/i.test(b)) return true;
  return false;
}

/**
 * Whether a Postgres `UserSavedDocument` row should be packed into LME sources.
 * Mirrors `ingestTickerFolder` eligibility for paths under `__ceg_user_saved_documents__/`, then
 * drops obvious non-capital-structure research (e.g. ABI-style news HTML classified as `other`).
 */
export function userSavedDocumentIncludedInLmeCorpus(
  filename: string,
  sizeBytes: number
): { ok: true } | { ok: false; reason: string } {
  const fn = filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) {
    return { ok: false, reason: "Invalid filename" };
  }

  const cfg = loadCreditMemoConfig();
  if (sizeBytes > cfg.maxIngestFileBytes) {
    return { ok: false, reason: "File exceeds CREDIT_MEMO_MAX_FILE_BYTES" };
  }

  const ext = path.extname(fn).toLowerCase();
  if (WORK_PRODUCT_EXCLUDED_EXCEL_EXT.has(ext)) {
    return { ok: false, reason: "Excel workbook — excluded from work-product text ingest" };
  }

  const rel = materializedSavedDocumentRelPath(fn);
  const wp = workspaceFileSkippedForWorkProductIngest(rel, "capstructure");
  if (wp.skip) {
    return { ok: false, reason: wp.parseNote ?? "Excluded by work-product ingest rules (capstructure scope)" };
  }

  const category = classifySourceFilename(rel);
  if (category === "news") {
    return { ok: false, reason: "Excluded for LME: news-style saved document" };
  }
  if (category === "notes" || category === "ai_chat") {
    return { ok: false, reason: "Excluded for LME: notes or chat export" };
  }

  if (category === "other") {
    const base = path.basename(fn).toLowerCase();
    if (kpiFilenameSuggestsCreditAgreementOrIndenture(base)) return { ok: true };
    if (otherFilenameLooksLikeSecOrDebtDoc(base)) return { ok: true };
    return {
      ok: false,
      reason: "Excluded for LME: generic saved document (not debt / SEC / org-style filename heuristics)",
    };
  }

  return { ok: true };
}
