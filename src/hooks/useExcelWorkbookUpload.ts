"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  type ExcelUploadItem,
  type ExcelWorkbookPreviewResult,
  type StyledSheetPreview,
  safeSheetPreviewGrid,
} from "@/lib/excel-workbook-preview";
import { extractXlsxArrayBufferFromApiText } from "@/lib/extract-xlsx-from-api-text";

export type UseExcelWorkbookUploadOptions = {
  ticker: string;
  apiBasePath: string;
  /** When null, render the full sheet without row/col caps. */
  previewMaxRows?: number | null;
  previewMaxCols?: number | null;
};

export function useExcelWorkbookUpload({
  ticker,
  apiBasePath,
  previewMaxRows = 80,
  previewMaxCols = 40,
}: UseExcelWorkbookUploadOptions) {
  const safeTicker = ticker?.trim() ?? "";
  const [items, setItems] = useState<ExcelUploadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [previewName, setPreviewName] = useState("");
  const [previewFilename, setPreviewFilename] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [styledPreview, setStyledPreview] = useState<StyledSheetPreview | null>(null);
  const [workbookBuffer, setWorkbookBuffer] = useState<ArrayBuffer | null>(null);

  const latestItem = items[0];
  const latestOpenUrl = useMemo(() => {
    if (!latestItem) return "";
    return `${apiBasePath}/${encodeURIComponent(safeTicker)}?file=${encodeURIComponent(latestItem.filename)}`;
  }, [latestItem, safeTicker, apiBasePath]);

  const fetchPreview = useCallback(
    async (filename: string, fileLabel: string, sheet?: string, buffer?: ArrayBuffer) => {
      const params = new URLSearchParams();
      if (sheet) params.set("sheet", sheet);
      if (previewMaxRows != null) params.set("maxRows", String(previewMaxRows));
      if (previewMaxCols != null) params.set("maxCols", String(previewMaxCols));

      let res: Response;
      if (buffer && buffer.byteLength > 0) {
        const form = new FormData();
        form.append("file", new Blob([buffer]), filename || "workbook.xlsx");
        res = await fetch(`/api/excel-workbook-preview?${params.toString()}`, {
          method: "POST",
          body: form,
        });
      } else {
        params.set("file", filename);
        params.set("preview", "1");
        res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}?${params.toString()}`);
      }

      const body = (await res.json()) as ExcelWorkbookPreviewResult & { error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Failed to load Excel preview.");

      setPreviewFilename(filename);
      setPreviewName(fileLabel);
      setSheetNames(Array.isArray(body.sheetNames) ? body.sheetNames : []);
      setActiveSheet(body.activeSheet ?? "");
      setGrid(Array.isArray(body.grid) ? body.grid : []);
      setStyledPreview(body.styledPreview ?? null);
    },
    [apiBasePath, previewMaxCols, previewMaxRows, safeTicker]
  );

  const refresh = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as { items?: ExcelUploadItem[]; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Failed to load excel uploads.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setItems([]);
      setStatus(e instanceof Error ? e.message : "Failed to load excel uploads.");
    } finally {
      setLoading(false);
    }
  }, [apiBasePath, safeTicker]);

  const loadWorkbookFromBuffer = useCallback(
    async (buf: ArrayBuffer, fileLabel: string, preferredSheet?: string) => {
      setWorkbookBuffer(buf.slice(0));
      if (!previewFilename) {
        setStatus("Save the workbook before previewing.");
        return;
      }
      await fetchPreview(previewFilename, fileLabel, preferredSheet);
    },
    [fetchPreview, previewFilename]
  );

  const loadAndPreviewLatest = useCallback(async () => {
    if (!latestItem) return;
    setStatus(null);
    try {
      await fetchPreview(latestItem.filename, latestItem.originalName || latestItem.filename);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to preview Excel file.");
      setGrid([]);
      setStyledPreview(null);
      setSheetNames([]);
      setActiveSheet("");
      setPreviewFilename("");
    }
  }, [fetchPreview, latestItem]);

  useEffect(() => {
    if (!safeTicker) return;
    void refresh();
  }, [safeTicker, refresh]);

  useEffect(() => {
    void loadAndPreviewLatest();
  }, [latestItem?.id, loadAndPreviewLatest]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!safeTicker) return;
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        setStatus("Please upload a .xlsx Excel file.");
        return;
      }

      setUploading(true);
      setStatus(null);
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        form.append("filename", file.name);

        const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`, {
          method: "POST",
          body: form,
        });
        const body = (await res.json()) as { ok?: boolean; error?: string; item?: ExcelUploadItem };
        if (!res.ok || body.ok !== true || !body.item) {
          throw new Error(body?.error ?? "Failed to upload Excel.");
        }

        setStatus("Excel saved.");
        const buf = (await file.arrayBuffer()).slice(0);
        setWorkbookBuffer(buf);
        await refresh();
        await fetchPreview(body.item.filename, file.name, undefined, buf);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Failed to upload Excel.");
      } finally {
        setUploading(false);
      }
    },
    [apiBasePath, fetchPreview, refresh, safeTicker]
  );

  const saveWorkbookBuffer = useCallback(
    async (buf: ArrayBuffer, filename: string) => {
      if (!safeTicker) return false;
      if (!filename.toLowerCase().endsWith(".xlsx")) {
        filename = `${filename.replace(/\.[^.]+$/, "")}.xlsx`;
      }

      setUploading(true);
      setStatus(null);
      try {
        const blob = new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const form = new FormData();
        form.append("file", blob, filename);
        form.append("filename", filename);

        const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`, {
          method: "POST",
          body: form,
        });
        const body = (await res.json()) as { ok?: boolean; error?: string; item?: ExcelUploadItem };
        if (!res.ok || body.ok !== true || !body.item) {
          throw new Error(body?.error ?? "Failed to save Excel.");
        }

        setWorkbookBuffer(buf.slice(0));
        await refresh();
        await fetchPreview(body.item.filename, filename, undefined, buf.slice(0));
        setStatus("Excel saved.");
        return true;
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Failed to save Excel.");
        return false;
      } finally {
        setUploading(false);
      }
    },
    [apiBasePath, fetchPreview, refresh, safeTicker]
  );

  const ingestFromApiText = useCallback(
    async (text: string, filename: string) => {
      const buf = extractXlsxArrayBufferFromApiText(text);
      if (!buf) return false;
      try {
        XLSX.read(buf, { type: "array" });
      } catch {
        return false;
      }
      return saveWorkbookBuffer(buf, filename);
    },
    [saveWorkbookBuffer]
  );

  const handleSheetSelect = useCallback(
    async (name: string) => {
      if (!name) return;
      const filename = previewFilename || latestItem?.filename;
      if (!filename) return;
      try {
        await fetchPreview(filename, previewName || latestItem?.originalName || filename, name);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Failed to preview selected sheet.");
      }
    },
    [fetchPreview, latestItem?.filename, latestItem?.originalName, previewFilename, previewName]
  );

  return {
    safeTicker,
    items,
    loading,
    uploading,
    status,
    previewName,
    sheetNames,
    activeSheet,
    grid,
    styledPreview,
    latestItem,
    latestOpenUrl,
    refresh,
    handleUpload,
    saveWorkbookBuffer,
    ingestFromApiText,
    loadWorkbookFromBuffer,
    handleSheetSelect,
    previewMaxRows,
    previewMaxCols,
    safeSheetPreviewGrid,
    workbookBuffer,
  };
}

export type ExcelWorkbookUploadState = ReturnType<typeof useExcelWorkbookUpload>;
