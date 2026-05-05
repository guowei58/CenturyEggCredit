import { createHash } from "crypto";

import { fetchSecArchivesRaw } from "@/lib/debt-map/documentFetch";
import { upsertSecArchivesExhibitAsSavedDocument } from "@/lib/saved-documents";

import type { DebtDocumentTableRow } from "@/lib/creditDocs/edgarDebtDocSearch/types";

/** Match Postgres `UserSavedDocument` row limit in `user-workspace-store`. */
const MAX_SAVED_DOC_BYTES = 35 * 1024 * 1024;

export type DebtDiscoverySavedRow = {
  filename: string;
  title: string;
  url: string;
  bytes: number;
};

export type DebtDiscoverySaveResult = {
  attempted: number;
  saved: DebtDiscoverySavedRow[];
  failed: Array<{ url: string; error: string }>;
  skippedIncorporatedByReference: number;
  skippedNonArchivesUrl: number;
  cappedOverMaxDownloads: number;
};

function isSecArchivesDocumentUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h !== "www.sec.gov" && h !== "sec.gov") return false;
    return u.pathname.includes("/Archives/edgar/data/");
  } catch {
    return false;
  }
}

function safeFilenameSegment(raw: string): string {
  return raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 120)
    .trim()
    .replace(/^\.+/, "") || "document";
}

function exhibitFilename(row: DebtDocumentTableRow): string {
  const url = row.directExhibitLink.trim();
  let base = "document";
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() || "document";
    base = decodeURIComponent(seg).replace(/\+/g, " ");
  } catch {
    /* ignore */
  }
  const safeBase = safeFilenameSegment(base).slice(0, 88);
  const acc = row.accessionNumber.replace(/[^a-zA-Z0-9]/g, "");
  const ex = String(row.exhibitNumber || "na")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 28);
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 10);
  let ext = "";
  if (/\.pdf(\?|$)/i.test(url)) ext = ".pdf";
  else if (/\.htm(l)?(\?|$)/i.test(url)) ext = ".html";
  else if (/\.txt(\?|$)/i.test(url)) ext = ".txt";
  else if (/\.xml(\?|$)/i.test(url)) ext = ".xml";
  else if (/\.doc(\?|$)/i.test(url)) ext = ".doc";
  else if (/\.docx(\?|$)/i.test(url)) ext = ".docx";
  else if (!/\.[a-zA-Z0-9]{2,8}(\?|$)/.test(safeBase)) ext = ".bin";

  const stem = `SEC-debt-${acc}-Ex${ex}-${safeBase}-${urlHash}${ext}`;
  return stem.length > 200 ? stem.slice(0, 200) : stem;
}

function rowTitle(row: DebtDocumentTableRow): string {
  const parts = [row.documentType, row.instrumentOrFacilityName].filter((s) => s && s.trim() && s !== "—");
  const t = parts.join(" — ").trim();
  return t.slice(0, 480) || "SEC exhibit";
}

/**
 * Download EDGAR exhibit URLs from a debt discovery table into the user's **Saved Documents** (Postgres).
 * Files are included automatically in LME / Entity Mapper / KPI / CS recommendation ingest pipelines.
 */
export async function saveDebtDiscoveryRowsToSavedDocuments(
  userId: string,
  ticker: string,
  rows: DebtDocumentTableRow[],
  opts?: { maxDownloads?: number }
): Promise<DebtDiscoverySaveResult> {
  const maxDownloads = Math.min(150, Math.max(1, opts?.maxDownloads ?? 80));

  const saved: DebtDiscoverySavedRow[] = [];
  const failed: Array<{ url: string; error: string }> = [];
  let skippedIncorporatedByReference = 0;
  let skippedNonArchivesUrl = 0;
  let cappedOverMaxDownloads = 0;

  const seenUrl = new Set<string>();
  const candidates: DebtDocumentTableRow[] = [];
  for (const row of rows) {
    const url = row.directExhibitLink.trim();
    if (!url) continue;
    const key = url.toLowerCase();
    if (seenUrl.has(key)) continue;
    seenUrl.add(key);
    if (row.status === "Incorporated by reference") {
      skippedIncorporatedByReference++;
      continue;
    }
    if (!isSecArchivesDocumentUrl(url)) {
      skippedNonArchivesUrl++;
      continue;
    }
    candidates.push(row);
  }

  const slice = candidates.slice(0, maxDownloads);
  cappedOverMaxDownloads = Math.max(0, candidates.length - slice.length);

  for (const row of slice) {
    const url = row.directExhibitLink.trim();
    const fetched = await fetchSecArchivesRaw(url);
    if (!fetched.ok) {
      failed.push({ url, error: fetched.error });
      continue;
    }
    if (fetched.buffer.length > MAX_SAVED_DOC_BYTES) {
      failed.push({ url, error: `Document exceeds ${MAX_SAVED_DOC_BYTES} byte storage limit` });
      continue;
    }
    if (fetched.buffer.length === 0) {
      failed.push({ url, error: "Empty response body" });
      continue;
    }

    const filename = exhibitFilename(row);
    const title = rowTitle(row);
    const up = await upsertSecArchivesExhibitAsSavedDocument(userId, ticker, {
      sourceUrl: url,
      filename,
      title,
      body: fetched.buffer,
      contentType: fetched.contentType,
    });
    if (!up.ok) {
      failed.push({ url, error: up.error });
      continue;
    }
    saved.push({ filename: up.item.filename, title: up.item.title, url, bytes: fetched.buffer.length });
  }

  return {
    attempted: slice.length,
    saved,
    failed,
    skippedIncorporatedByReference,
    skippedNonArchivesUrl,
    cappedOverMaxDownloads,
  };
}
