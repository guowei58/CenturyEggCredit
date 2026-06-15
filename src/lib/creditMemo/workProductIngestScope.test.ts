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
      "kpi-latest-meta.json",
      "literary-references-latest.md",
    ];
    expect(memoAllows(paths, "kpi-latest.md")).toBe(true);
    expect(memoAllows(paths, "forensic-accounting-latest.md")).toBe(true);
    expect(memoAllows(paths, "lme-analysis.md")).toBe(true);
    expect(memoAllows(paths, "cs-recommendation-latest.md")).toBe(true);
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

  it("memo scope keeps only latest 10-K and latest 10-Q among SEC filings", () => {
    const paths = [
      "__ceg_user_saved_documents__/MSFT_10-K-FY2022.html",
      "__ceg_user_saved_documents__/MSFT_10-K-FY2024.html",
      "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q1.html",
      "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q3.html",
      "__ceg_user_saved_documents__/d353521dex101.html",
    ];
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-K-FY2024.html")).toBe(true);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-K-FY2022.html")).toBe(false);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q3.html")).toBe(true);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/MSFT_10-Q-2024-Q1.html")).toBe(false);
    expect(memoAllows(paths, "__ceg_user_saved_documents__/d353521dex101.html")).toBe(false);
  });

  it("memo scope keeps saved-tab txt, mgmt presentations, and earnings transcripts", () => {
    const paths = [
      "overview.txt",
      "employee-contacts.html",
      "MSFT_earnings-transcript_2024-Q3.txt",
      "MSFT-mgmt-presentation.pdf",
      "research/notes.txt",
    ];
    expect(memoAllows(paths, "overview.txt")).toBe(true);
    expect(memoAllows(paths, "employee-contacts.html")).toBe(true);
    expect(memoAllows(paths, "MSFT_earnings-transcript_2024-Q3.txt")).toBe(true);
    expect(memoAllows(paths, "MSFT-mgmt-presentation.pdf")).toBe(true);
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
  it("includes all five source categories", () => {
    const allow = buildMemoDeckIngestAllowSet([
      "kpi-latest.md",
      "overview.txt",
      "MSFT_10-K-FY2024.html",
      "MSFT_10-K-FY2022.html",
      "MSFT_10-Q-2024-Q2.html",
      "AAPL-mgmt-presentation.pdf",
      "AAPL_earnings-transcript_2024-Q1.txt",
    ]);
    expect(allow.has("kpi-latest.md")).toBe(true);
    expect(allow.has("overview.txt")).toBe(true);
    expect(allow.has("msft_10-k-fy2024.html")).toBe(true);
    expect(allow.has("msft_10-k-fy2022.html")).toBe(false);
    expect(allow.has("msft_10-q-2024-q2.html")).toBe(true);
    expect(allow.has("aapl-mgmt-presentation.pdf")).toBe(true);
    expect(allow.has("aapl_earnings-transcript_2024-q1.txt")).toBe(true);
  });
});
