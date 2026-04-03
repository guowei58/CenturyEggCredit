"use client";

import { OrgChartExcelFileBox } from "@/components/OrgChartExcelFileBox";

export function CapitalStructureExcelFileBox({ ticker }: { ticker: string }) {
  return (
    <OrgChartExcelFileBox
      ticker={ticker}
      apiBasePath="/api/capital-structure-excel"
      emptyMessage="Select a company to upload a capital structure Excel file."
    />
  );
}

