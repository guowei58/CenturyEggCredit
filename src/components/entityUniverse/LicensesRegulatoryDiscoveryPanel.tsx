"use client";

import matrix from "../../../data/licenses_regulatory_matrix_50_states.json";
import { PublicRecordsTwoLinkDiscoveryPanel } from "@/components/entityUniverse/PublicRecordsTwoLinkDiscoveryPanel";

export function LicensesRegulatoryDiscoveryPanel({
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
      title="Licenses & regulatory"
      matrix={matrix as Record<string, any>}
    />
  );
}

