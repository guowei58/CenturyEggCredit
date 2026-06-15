"use client";

import {
  WorkProductSourcedAnalysisTab,
  type WorkProductSourcedTabConfig,
} from "@/components/WorkProductSourcedAnalysisTab";

const CONFIG: WorkProductSourcedTabConfig = {
  kind: "forensic",
  title: "Forensic Analysis",
  apiPath: "/api/forensic-analysis",
  savedContentKey: "forensic-accounting-latest",
  includeCompanyName: true,
  refreshSourcesStep: (
    <>
      Click <strong>Refresh sources</strong> to rescan saved tab business model, saved tab how stuff works, latest saved
      10-K, saved tab risk from 10-K, and saved tab business risk analysis.
    </>
  ),
  sourceInventoryNote: "Five forensic inputs only — four saved tabs plus latest 10-K.",
  noSubstantiveMessage:
    "No substantive forensic text found. Save the required tabs and a readable 10-K, then refresh sources.",
  emptyOutputMessage:
    "No saved forensic analysis yet. Build the context window, run the model, then paste or save the response here.",
};

export function CompanyForensicAnalysisTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  return <WorkProductSourcedAnalysisTab ticker={ticker} companyName={companyName} config={CONFIG} />;
}
