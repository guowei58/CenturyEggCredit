import type { DebtFootnoteCandidate, DebtSectionExtractResult } from "@/lib/secDebtSectionExtract";

export type DebtFootnoteRollForward = {
  sourceForm: "10-K";
  sourceFilingDate: string;
  sourceAccessionNumber: string;
  sourceDocUrl: string;
};

export function debtFootnoteHasDisplayHtml(extract: DebtSectionExtractResult): boolean {
  const html = (extract.extractedFootnoteHtml ?? "").trim() || (extract.tablesHtml ?? "").trim();
  return html.length > 80;
}

export function shouldRollForwardDebtFrom10K(form: string, extract: DebtSectionExtractResult): boolean {
  if (form !== "10-Q") return false;
  if (debtFootnoteHasDisplayHtml(extract) && extract.confidence !== "Not Found") return false;
  return extract.confidence === "Not Found" || extract.confidence === "Low";
}

export function pickBestUnverifiedDebtCandidate(
  extract: DebtSectionExtractResult
): DebtFootnoteCandidate | null {
  const candidates = extract.candidates ?? [];
  if (!candidates.length) return null;
  const pick = candidates.find((c) => c.selected) ?? candidates[0];
  if (!pick) return null;
  const score = pick.totalDebtScore ?? 0;
  const title = `${pick.titleRaw ?? ""}`.toLowerCase();
  const hasDebtTitle =
    /\bdebt\b|\bborrowings?\b|\bcredit\s+facilit|\bline\s+of\s+credit|\bcommercial\s+paper|\bindebtedness\b/i.test(
      title
    );
  if (score < 60) return null;
  if (!hasDebtTitle && score < 75) return null;
  return pick;
}
