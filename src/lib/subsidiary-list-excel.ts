import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  workspaceReadFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

export type SubsidiaryListExcelItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

const SUBFOLDER_NAME = "Subsidiary List Excel";
const MANIFEST_FILE = "subsidiary-list-excel.json";

function manifestPath(): string {
  return `${SUBFOLDER_NAME}/${MANIFEST_FILE}`;
}

function blobPath(filename: string): string {
  return `${SUBFOLDER_NAME}/${filename}`;
}

function looksLikeXlsx(name: string): boolean {
  return name.toLowerCase().endsWith(".xlsx");
}

function toSafeFilename(raw: string): string {
  const trimmed = (raw || "").trim();
  const extOk = looksLikeXlsx(trimmed) ? ".xlsx" : ".xlsx";
  const base = trimmed.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
  const safeBase = base.length > 0 ? base.slice(0, 120) : "subsidiary-list-input";
  return `${safeBase}${extOk}`;
}

async function loadManifest(userId: string, safeTicker: string): Promise<SubsidiaryListExcelItem[]> {
  const raw = await workspaceReadUtf8(userId, safeTicker, manifestPath());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SubsidiaryListExcelItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(userId: string, safeTicker: string, items: SubsidiaryListExcelItem[]): Promise<void> {
  await workspaceWriteUtf8(userId, safeTicker, manifestPath(), JSON.stringify(items, null, 2));
}

export async function listSubsidiaryListExcels(
  userId: string,
  ticker: string
): Promise<SubsidiaryListExcelItem[] | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;
  const items = await loadManifest(userId, safeTicker);
  return items.filter((it) => it.ticker === safeTicker).sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
}

export async function getSubsidiaryListExcelBuffer(
  userId: string,
  ticker: string,
  filename: string
): Promise<Buffer | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;
  const fn = filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) return null;
  return workspaceReadFile(userId, safeTicker, blobPath(fn));
}

export async function saveSubsidiaryListExcelFile(params: {
  userId: string;
  ticker: string;
  fileBuffer: Buffer;
  originalName: string;
  maxBytes?: number;
}): Promise<{ ok: true; item: SubsidiaryListExcelItem } | { ok: false; error: string }> {
  const { userId, ticker, fileBuffer, originalName, maxBytes = 8_000_000 } = params;
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  if (!fileBuffer || !fileBuffer.length) return { ok: false, error: "Empty file" };
  if (!looksLikeXlsx(originalName || "")) return { ok: false, error: "Please upload a .xlsx file." };
  if (fileBuffer.length > maxBytes) return { ok: false, error: `File too large (max ${Math.round(maxBytes / 1_000_000)}MB).` };

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeOriginal = toSafeFilename(originalName || "subsidiary-list-input.xlsx");
  const filename = `${stamp} - ${safeOriginal}`;

  const w = await workspaceWriteFile(userId, safeTicker, blobPath(filename), fileBuffer);
  if (!w.ok) return w;

  const item: SubsidiaryListExcelItem = {
    id: `${safeTicker}-${stamp}-${Math.random().toString(16).slice(2)}`,
    ticker: safeTicker,
    filename,
    originalName: originalName || safeOriginal,
    savedAtIso: now.toISOString(),
    bytes: fileBuffer.length,
  };

  const manifest = await loadManifest(userId, safeTicker);
  manifest.unshift(item);
  await writeManifest(userId, safeTicker, manifest.slice(0, 50));

  return { ok: true, item };
}
