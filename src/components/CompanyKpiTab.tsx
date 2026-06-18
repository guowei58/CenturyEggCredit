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
  noSubstantiveMessage:
    "No substantive KPI pack yet. Save at least one management presentation or earnings transcript from Period Financials.",
  emptyOutputMessage: "No saved commentary yet. Build the context window, run the model, then paste or save the response here.",
};

export function CompanyKpiTab({ ticker, companyName }: { ticker: string; companyName?: string }) {
  return <WorkProductSourcedAnalysisTab ticker={ticker} companyName={companyName} config={CONFIG} />;
}
