"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { ExcelWorkbookExpandableViewer } from "@/components/ExcelWorkbookExpandableViewer";
import { ExcelWorkbookUploadStrip } from "@/components/ExcelWorkbookUploadStrip";
import { GenericExcelWorkbookFileBox } from "@/components/GenericExcelWorkbookFileBox";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { ORG_CHART_SAMPLE_IMAGE_PATHS } from "@/data/org-chart-prompt";
import { useExcelWorkbookUpload, type ExcelWorkbookUploadState } from "@/hooks/useExcelWorkbookUpload";

const OrgChartExcelContext = createContext<ExcelWorkbookUploadState | null>(null);

export function useOrgChartExcel() {
  const ctx = useContext(OrgChartExcelContext);
  if (!ctx) throw new Error("OrgChartExcel components must be used within OrgChartExcelProvider");
  return ctx;
}

export function OrgChartExcelProvider({ ticker, children }: { ticker: string; children: ReactNode }) {
  const state = useExcelWorkbookUpload({
    ticker,
    apiBasePath: "/api/org-chart-excel",
    previewMaxRows: null,
    previewMaxCols: null,
  });
  return <OrgChartExcelContext.Provider value={state}>{children}</OrgChartExcelContext.Provider>;
}

export function OrgChartExcelUpload() {
  const { uploading, loading, status, previewName, latestItem, latestOpenUrl, handleUpload } = useOrgChartExcel();
  const fileName = previewName || latestItem?.originalName || latestItem?.filename || "";

  return (
    <ExcelWorkbookUploadStrip
      uploading={uploading}
      loading={loading}
      status={status}
      fileName={fileName}
      latestItem={latestItem}
      latestOpenUrl={latestOpenUrl}
      handleUpload={handleUpload}
    />
  );
}

export function OrgChartExcelViewer() {
  const { previewName, sheetNames, activeSheet, styledPreview, handleSheetSelect } = useOrgChartExcel();

  return (
    <ExcelWorkbookExpandableViewer
      previewName={previewName}
      sheetNames={sheetNames}
      activeSheet={activeSheet}
      styledPreview={styledPreview}
      onSheetSelect={(name) => void handleSheetSelect(name)}
      hideTitle
      emptyMessage="Upload an org chart Excel file (.xlsx) or run an API model — the workbook appears here with all worksheet tabs."
    />
  );
}

export function OrgChartTabPromptApiButtons({
  userPrompt,
  onApiStatus,
  onApiFinished,
}: {
  userPrompt: string;
  onApiStatus?: (message: string) => void;
  onApiFinished?: () => void;
}) {
  const { safeTicker, ingestFromApiText } = useOrgChartExcel();

  return (
    <TabPromptApiButtons
      userPrompt={userPrompt}
      samplePublicPaths={ORG_CHART_SAMPLE_IMAGE_PATHS}
      onRunStart={() => onApiStatus?.("")}
      onResult={() => {
        onApiFinished?.();
      }}
      persistAfterResult={async (text) => {
        if (!safeTicker) return;
        const filename = `${safeTicker}-org-chart-api.xlsx`;
        const saved = await ingestFromApiText(text, filename);
        if (saved) {
          onApiStatus?.("Excel workbook from API saved and shown in the viewer.");
        } else {
          onApiStatus?.(
            "API finished. No embedded .xlsx was found in the response — upload the file manually if the model returned code or a download link."
          );
        }
      }}
      className="mt-3 border-t border-[var(--border2)] pt-3"
    />
  );
}

/** @deprecated Use OrgChartExcelProvider + Upload + Viewer instead. */
export function OrgChartExcelFileBox(props: ComponentProps<typeof GenericExcelWorkbookFileBox>) {
  return <GenericExcelWorkbookFileBox {...props} />;
}
