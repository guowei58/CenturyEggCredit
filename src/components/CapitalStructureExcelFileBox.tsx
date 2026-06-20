"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ExcelWorkbookExpandableViewer } from "@/components/ExcelWorkbookExpandableViewer";
import { ExcelWorkbookUploadStrip } from "@/components/ExcelWorkbookUploadStrip";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS } from "@/data/capital-structure-prompt";
import { useExcelWorkbookUpload, type ExcelWorkbookUploadState } from "@/hooks/useExcelWorkbookUpload";

const CapitalStructureExcelContext = createContext<ExcelWorkbookUploadState | null>(null);

export function useCapitalStructureExcel() {
  const ctx = useContext(CapitalStructureExcelContext);
  if (!ctx) throw new Error("CapitalStructureExcel components must be used within CapitalStructureExcelProvider");
  return ctx;
}

export function CapitalStructureExcelProvider({ ticker, children }: { ticker: string; children: ReactNode }) {
  const state = useExcelWorkbookUpload({
    ticker,
    apiBasePath: "/api/capital-structure-excel",
    previewMaxRows: null,
    previewMaxCols: null,
  });
  return <CapitalStructureExcelContext.Provider value={state}>{children}</CapitalStructureExcelContext.Provider>;
}

export function CapitalStructureExcelUpload() {
  const { uploading, loading, status, previewName, latestItem, latestOpenUrl, handleUpload } =
    useCapitalStructureExcel();
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

export function CapitalStructureExcelViewer() {
  const { previewName, sheetNames, activeSheet, styledPreview, handleSheetSelect } = useCapitalStructureExcel();

  return (
    <ExcelWorkbookExpandableViewer
      previewName={previewName}
      sheetNames={sheetNames}
      activeSheet={activeSheet}
      styledPreview={styledPreview}
      onSheetSelect={(name) => void handleSheetSelect(name)}
      hideTitle
      emptyMessage="Upload a capital structure Excel file (.xlsx) or run an API model — the workbook appears here with all worksheet tabs."
    />
  );
}

export function CapitalStructureTabPromptApiButtons({
  userPrompt,
  onApiStatus,
  onApiFinished,
}: {
  userPrompt: string;
  onApiStatus?: (message: string) => void;
  onApiFinished?: () => void;
}) {
  const { safeTicker, ingestFromApiText } = useCapitalStructureExcel();

  return (
    <TabPromptApiButtons
      userPrompt={userPrompt}
      researchSaveKey="capital-structure"
      samplePublicPaths={CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS}
      onRunStart={() => onApiStatus?.("")}
      onResult={() => {
        onApiFinished?.();
      }}
      persistAfterResult={async (text) => {
        if (!safeTicker) return;
        const filename = `${safeTicker}-capital-structure-api.xlsx`;
        const saved = await ingestFromApiText(text, filename);
        if (saved) {
          onApiStatus?.("Excel workbook from API saved — showing in the viewer above.");
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

/** @deprecated Use CapitalStructureExcelProvider + Upload + Viewer instead. */
export function CapitalStructureExcelFileBox({ ticker }: { ticker: string }) {
  return (
    <CapitalStructureExcelProvider ticker={ticker}>
      <CapitalStructureExcelUpload />
      <CapitalStructureExcelViewer />
    </CapitalStructureExcelProvider>
  );
}
