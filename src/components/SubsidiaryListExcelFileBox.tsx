"use client";

import { GenericExcelWorkbookFileBox } from "@/components/GenericExcelWorkbookFileBox";

export function SubsidiaryListExcelFileBox({ ticker }: { ticker: string }) {
  return (
    <GenericExcelWorkbookFileBox
      ticker={ticker}
      apiBasePath="/api/subsidiary-list-excel"
      emptyMessage="Select a company to upload a subsidiary list Excel file."
    />
  );
}
