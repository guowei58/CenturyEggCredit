"use client";

import { OrgChartExcelFileBox } from "@/components/OrgChartExcelFileBox";

export function SubsidiaryListExcelFileBox({ ticker }: { ticker: string }) {
  return (
    <OrgChartExcelFileBox
      ticker={ticker}
      apiBasePath="/api/subsidiary-list-excel"
      emptyMessage="Select a company to upload a subsidiary list Excel file."
    />
  );
}
