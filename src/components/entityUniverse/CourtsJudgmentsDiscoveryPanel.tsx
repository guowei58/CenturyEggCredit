"use client";

import matrix from "../../../data/courts_judgments_matrix_50_states.json";
import { PublicRecordsTwoLinkDiscoveryPanel } from "@/components/entityUniverse/PublicRecordsTwoLinkDiscoveryPanel";

export function CourtsJudgmentsDiscoveryPanel({
  ticker,
  companyName,
  issuerStateOfIncorporation,
}: {
  ticker: string;
  companyName?: string;
  issuerStateOfIncorporation?: string | null;
}) {
  return (
    <PublicRecordsTwoLinkDiscoveryPanel
      ticker={ticker}
      companyName={companyName}
      issuerStateOfIncorporation={issuerStateOfIncorporation}
      title="Courts & judgments"
      matrix={matrix as Record<string, any>}
    />
  );
}

