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
