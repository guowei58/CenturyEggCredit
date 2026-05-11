"use client";

import matrix from "../../../data/procurement_contracts_matrix_50_states.json";
import { PublicRecordsTwoLinkDiscoveryPanel } from "@/components/entityUniverse/PublicRecordsTwoLinkDiscoveryPanel";

export function ProcurementContractsDiscoveryPanel({
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
      title="Procurement & local contracts"
      matrix={matrix as Record<string, any>}
    />
  );
}

