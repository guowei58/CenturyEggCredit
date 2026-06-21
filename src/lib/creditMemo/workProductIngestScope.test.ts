import { describe, expect, it } from "vitest";

import {
  buildMemoDeckIngestAllowSet,
  isMemoDeckLibraryWorkspacePath,
  kpiFilenameSuggestsCreditAgreementOrIndenture,
  memoDeckRestrictedIngestKeep,
  workspaceFileSkippedForWorkProductIngest,
} from "./workProductIngestScope";

function memoAllows(allPaths: string[], rel: string): boolean {
  const allow = buildMemoDeckIngestAllowSet(allPaths);
  return !workspaceFileSkippedForWorkProductIngest(rel, "memo", { memoDeckAllowSet: allow }).skip;
}

describe("isMemoDeckLibraryWorkspacePath", () => {
  it("flags index, memos, and decks under the library tree", () => {
    expect(isMemoDeckLibraryWorkspacePath("ai-memo-deck-library/index.json")).toBe(true);
    expect(isMemoDeckLibraryWorkspacePath("ai-memo-deck-library/memos/17215dc3-1266-42c9-ab3d-9da18576ef54.md")).toBe(
      true
    );
    expect(isMemoDeckLibraryWorkspacePath("Research/notes.txt")).toBe(false);
  });
});

describe("kpiFilenameSuggestsCreditAgreementOrIndenture", () => {
  it("detects SEC dex10x material-contract style names glued to digits", () => {
    expect(kpiFilenameSuggestsCreditAgreementOrIndenture("d353521dex101.html")).toBe(true);
    expect(kpiFilenameSuggestsCreditAgreementOrIndenture("2026-04-15 - d353521dex101.html")).toBe(true);
  });

  it("detects indenture in basename", () => {
    expect(kpiFilenameSuggestsCreditAgreementOrIndenture("exhibit41-indenturex57.html")).toBe(true);
  });

  it("does not flag ordinary research filenames", () => {
    expect(kpiFilenameSuggestsCreditAgreementOrIndenture("industry-history-drivers.txt")).toBe(false);
    expect(kpiFilenameSuggestsCreditAgreementOrIndenture("overview.txt")).toBe(false);
  });
});

describe("workspaceFileSkippedForWorkProductIngest", () => {
  it("kpi scope skips prior KPI outputs, XBRL compiler JSON, financial model, credit agreements, and cap structure", () => {
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest.md", "kpi").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("xbrl-deterministic-compiler-result.json", "kpi").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("capital-structure.txt", "kpi").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("credit-agreements-indentures.txt", "kpi").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("Credit Agreements & Indentures/foo.pdf", "kpi").skip).toBe(true);
    expect(
      workspaceFileSkippedForWorkProductIngest(
        "__ceg_user_saved_documents__/2026-04-15T14-46-23-571Z - d353521dex101.html",
        "kpi"
      ).skip
    ).toBe(true);
    expect(
      workspaceFileSkippedForWorkProductIngest(
        "__ceg_user_saved_documents__/2026-04-15T14-46-34-669Z - exhibit41-indenturex57.html",
        "kpi"
      ).skip
    ).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("industry-history-drivers.txt", "kpi").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("ai-credit-memo-latest.md", "kpi").skip).toBe(true);
  });

  it("memo scope ingests KPI, forensic, LME, and recommendation markdown but not meta, packs, or other generated tabs", () => {
    const paths = [
      "kpi-latest.md",
      "forensic-accounting-latest.md",
      "lme-analysis.md",
      "cs-recommendation-latest.md",
      "xbrl-consolidated-financials-ai.md",
      "kpi-latest-meta.json",
      "literary-references-latest.md",
    ];
    expect(memoAllows(paths, "kpi-latest.md")).toBe(true);
    expect(memoAllows(paths, "forensic-accounting-latest.md")).toBe(true);
    expect(memoAllows(paths, "lme-analysis.md")).toBe(true);
    expect(memoAllows(paths, "cs-recommendation-latest.md")).toBe(true);
    expect(memoAllows(paths, "xbrl-consolidated-financials-ai.md")).toBe(true);
    expect(memoAllows(paths, "kpi-latest-meta.json")).toBe(false);
    expect(memoAllows(paths, "kpi-latest-source-pack.txt")).toBe(false);
    expect(memoAllows(paths, "literary-references-latest.md")).toBe(false);
    expect(memoAllows(paths, "ai-credit-memo-buffett.md")).toBe(false);
    expect(memoAllows(paths, "entity-mapper-latest.md")).toBe(false);
  });

  it("forensic scope skips KPI and other tabs’ generated files", () => {
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest.md", "forensic").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest-source-pack.txt", "forensic").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("ai-credit-memo-buffett.md", "forensic").skip).toBe(true);
  });

  it("memo scope keeps only latest 10-K among SEC filings (no 10-Q)", () => {
    const paths = [
      "__ceg_user_saved_documents__/MSFT_10-K-FY2022.html",
      "__ceg_user_saved_documents__/MSFT_10-K-FY2024.html",
      "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q1.html",
      "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q3.html",
      "__ceg_user_saved_documents__/d353521dex101.html",
    ];
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-K-FY2024.html")).toBe(true);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-K-FY2022.html")).toBe(false);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q3.html")).toBe(false);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q1.html")).toBe(false);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/d353521dex101.html")).toBe(false);
  });

  it("memo scope keeps saved-tab txt and last-four-quarters period financials only", () => {
    const paths = [
      "overview.txt",
      "employee-contacts.html",
      "GEN_earnings-transcript_1Q_2025.txt",
      "GEN_earnings-transcript_2Q_2025.txt",
      "GEN_earnings-transcript_3Q_2025.txt",
      "GEN_earnings-transcript_1Q_2026.txt",
      "GEN_earnings-transcript_2Q_2026.txt",
      "GEN-Q1-2026-mgmt-presentation.pdf",
      "GEN-Q3-2023-mgmt-presentation.pdf",
      "research/notes.txt",
    ];
    expect(memoAllows(paths, "overview.txt")).toBe(true);
    expect(memoAllows(paths, "employee-contacts.html")).toBe(false);
    expect(memoAllows(paths, "industry-contacts.html")).toBe(false);
    expect(memoAllows(paths, "GEN_earnings-transcript_2Q_2026.txt")).toBe(true);
    expect(memoAllows(paths, "GEN_earnings-transcript_1Q_2026.txt")).toBe(true);
    expect(memoAllows(paths, "GEN_earnings-transcript_1Q_2025.txt")).toBe(false);
    expect(memoAllows(paths, "GEN_earnings-transcript_2Q_2025.txt")).toBe(false);
    expect(memoAllows(paths, "GEN_earnings-transcript_3Q_2025.txt")).toBe(true);
    expect(memoAllows(paths, "GEN-Q1-2026-mgmt-presentation.pdf")).toBe(true);
    expect(memoAllows(paths, "GEN-Q3-2023-mgmt-presentation.pdf")).toBe(false);
    expect(memoAllows(paths, "research/notes.txt")).toBe(false);
    expect(memoDeckRestrictedIngestKeep("research/investor-deck-roadshow.pdf")).toBe(false);
  });

  it("always skips deck library tree and ai-credit-deck.txt", () => {
    expect(workspaceFileSkippedForWorkProductIngest("ai-memo-deck-library/x.pptx", "kpi").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("ai-credit-deck.txt", "memo").skip).toBe(true);
  });

  it("always skips credit-memo app subtree (e.g. LME embedding cache)", () => {
    expect(
      workspaceFileSkippedForWorkProductIngest("credit-memo/lme-retrieval-embeddings/CAR.json", "forensic").skip
    ).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("credit-memo/kpi-embeddings/x.json", "memo").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("Credit-Memo/state.json", "kpi").skip).toBe(true);
  });
});

describe("buildMemoDeckIngestAllowSet", () => {
  it("includes work-product md, saved tabs, latest 10-K, and recent period financials", () => {
    const allow = buildMemoDeckIngestAllowSet([
      "kpi-latest.md",
      "overview.txt",
      "MSFT_10-K-FY2024.html",
      "MSFT_10-K-FY2022.html",
      "MSFT_10-Q-2024-Q2.html",
      "GEN_earnings-transcript_3Q_2025.txt",
      "GEN_earnings-transcript_1Q_2026.txt",
      "GEN_earnings-transcript_2Q_2026.txt",
      "GEN-Q1-2026-mgmt-presentation.pdf",
      "GEN-Q3-2023-mgmt-presentation.pdf",
    ]);
    expect(allow.has("kpi-latest.md")).toBe(true);
    expect(allow.has("overview.txt")).toBe(true);
    expect(allow.has("msft_10-k-fy2024.html")).toBe(true);
    expect(allow.has("msft_10-k-fy2022.html")).toBe(false);
    expect(allow.has("msft_10-q-2024-q2.html")).toBe(false);
    expect(allow.has("gen_earnings-transcript_2q_2026.txt")).toBe(true);
    expect(allow.has("gen_earnings-transcript_1q_2026.txt")).toBe(true);
    expect(allow.has("gen_earnings-transcript_3q_2025.txt")).toBe(true);
    expect(allow.has("gen_earnings-transcript_1q_2025.txt")).toBe(false);
    expect(allow.has("gen-q1-2026-mgmt-presentation.pdf")).toBe(true);
    expect(allow.has("gen-q3-2023-mgmt-presentation.pdf")).toBe(false);
  });
});
