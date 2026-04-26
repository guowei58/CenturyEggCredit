import { describe, expect, it } from "vitest";

import {
  isMemoDeckLibraryWorkspacePath,
  kpiFilenameSuggestsCreditAgreementOrIndenture,
  memoDeckRestrictedIngestKeep,
  workspaceFileSkippedForWorkProductIngest,
} from "./workProductIngestScope";

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
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest.md", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("forensic-accounting-latest.md", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("lme-analysis.md", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("cs-recommendation-latest.md", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest-meta.json", "memo").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest-source-pack.txt", "memo").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("literary-references-latest.md", "memo").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("ai-credit-memo-buffett.md", "memo").skip).toBe(true);
  });

  it("forensic scope skips KPI and other tabs’ generated files", () => {
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest.md", "forensic").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("kpi-latest-source-pack.txt", "forensic").skip).toBe(true);
    expect(workspaceFileSkippedForWorkProductIngest("ai-credit-memo-buffett.md", "forensic").skip).toBe(true);
  });

  it("memo scope still ingests dex101-style SEC filenames (SEC filing classifier)", () => {
    expect(workspaceFileSkippedForWorkProductIngest("__ceg_user_saved_documents__/d353521dex101.html", "memo").skip).toBe(false);
  });

  it("memo scope keeps saved-tab txt and skips unrelated research files", () => {
    expect(workspaceFileSkippedForWorkProductIngest("overview.txt", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("employee-contacts.html", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("research/foo.txt", "memo").skip).toBe(true);
    expect(memoDeckRestrictedIngestKeep("research/investor-deck-roadshow.pdf")).toBe(true);
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
    expect(workspaceFileSkippedForWorkProductIngest("research/10k.txt", "memo").skip).toBe(false);
    expect(workspaceFileSkippedForWorkProductIngest("research/notes.txt", "memo").skip).toBe(true);
  });
});
