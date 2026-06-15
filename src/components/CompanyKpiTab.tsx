"use client";

import {
  WorkProductSourcedAnalysisTab,
  type WorkProductSourcedTabConfig,
} from "@/components/WorkProductSourcedAnalysisTab";

const CONFIG: WorkProductSourcedTabConfig = {
  kind: "kpi",
  title: "KPI Commentary",
  apiPath: "/api/kpi-commentary",
  savedContentKey: "kpi-latest",
  includeCompanyName: true,
  refreshSourcesStep: (
    <>
      Click <strong>Refresh sources</strong> to rescan Period Financials transcripts and management presentations saved to{" "}
      <strong>Saved Documents</strong>.
    </>
  ),
  sourceInventoryNote: "Ingestion uses transcripts and management presentations from Period Financials.",
  noSubstantiveMessage:
    "No substantive KPI pack yet. Save at least one management presentation or earnings transcript from Period Financials.",
  emptyOutputMessage: "No saved commentary yet. Build the context window, run the model, then paste or save the response here.",
};

export function CompanyKpiTab({ ticker, companyName }: { ticker: string; companyName?: string }) {
  return <WorkProductSourcedAnalysisTab ticker={ticker} companyName={companyName} config={CONFIG} />;
}
