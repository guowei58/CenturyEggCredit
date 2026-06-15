"use client";

import {
  WorkProductSourcedAnalysisTab,
  type WorkProductSourcedTabConfig,
} from "@/components/WorkProductSourcedAnalysisTab";

const CONFIG: WorkProductSourcedTabConfig = {
  kind: "lme",
  title: "LME Analysis",
  apiPath: "/api/lme-analysis",
  savedContentKey: "lme-analysis",
  refreshSourcesStep: (
    <>
      Click <strong>Refresh sources</strong> to rescan Capital Structure section saved tabs and documents, plus the saved{" "}
      <strong>business model</strong> tab.
    </>
  ),
  sourceInventoryNote: "Uses Capital Structure uploads and saved credit-agreement tabs plus business model.",
  noSubstantiveMessage:
    "No substantive LME sources found. Save Capital Structure section tabs/docs and the business model tab.",
  emptyOutputMessage: "No saved LME analysis yet. Build the context window, run the model, then paste or save the response here.",
};

export function CompanyLmeAnalysisTab({ ticker }: { ticker: string }) {
  return <WorkProductSourcedAnalysisTab ticker={ticker} config={CONFIG} />;
}
