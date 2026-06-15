"use client";

import {
  WorkProductSourcedAnalysisTab,
  type WorkProductSourcedTabConfig,
} from "@/components/WorkProductSourcedAnalysisTab";

const CONFIG: WorkProductSourcedTabConfig = {
  kind: "recommendation",
  title: "Recommendation",
  apiPath: "/api/cs-recommendation",
  savedContentKey: "cs-recommendation-latest",
  refreshSourcesStep: (
    <>
      Click <strong>Refresh sources</strong> to rescan saved tab text files plus saved LME, KPI, and Forensic outputs.
    </>
  ),
  sourceInventoryNote: "Uses saved tab .txt files and latest LME, KPI, and Forensic markdown outputs.",
  noSubstantiveMessage:
    "No substantive recommendation sources found. Save tab responses and/or LME, KPI, or Forensic outputs.",
  emptyOutputMessage:
    "No saved recommendation yet. Build the context window, run the model, then paste or save the response here.",
};

export function CompanyCapStructureRecommendationTab({ ticker }: { ticker: string }) {
  return <WorkProductSourcedAnalysisTab ticker={ticker} config={CONFIG} />;
}
