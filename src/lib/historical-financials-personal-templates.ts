import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import {
  workspaceReadFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

export type HistoricalFinancialsPersonalTemplateItem = {
  id: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

const SUBFOLDER_NAME = "Historical Financials Personal Templates";
const MANIFEST_FILE = "personal-templates.json";

function workspaceTicker(): string {
  return sanitizeTicker(WORKSPACE_GLOBAL_TICKER) ?? "GLOBAL";
}

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
  const safeBase = base.length > 0 ? base.slice(0, 120) : "historical-financials-template";
  return `${safeBase}${extOk}`;
}

async function loadManifest(userId: string): Promise<HistoricalFinancialsPersonalTemplateItem[]> {
  const t = workspaceTicker();
  const raw = await workspaceReadUtf8(userId, t, manifestPath());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HistoricalFinancialsPersonalTemplateItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(userId: string, items: HistoricalFinancialsPersonalTemplateItem[]): Promise<void> {
  const t = workspaceTicker();
  await workspaceWriteUtf8(userId, t, manifestPath(), JSON.stringify(items, null, 2));
}

export async function listHistoricalFinancialsPersonalTemplates(
  userId: string
): Promise<HistoricalFinancialsPersonalTemplateItem[]> {
  const items = await loadManifest(userId);
  return items.sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
}

export async function getHistoricalFinancialsPersonalTemplateBuffer(
  userId: string,
  filename: string
): Promise<Buffer | null> {
  const fn = filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) return null;
  const t = workspaceTicker();
  return workspaceReadFile(userId, t, blobPath(fn));
}

export async function saveHistoricalFinancialsPersonalTemplateFile(params: {
  userId: string;
  fileBuffer: Buffer;
  originalName: string;
  maxBytes?: number;
}): Promise<
  { ok: true; item: HistoricalFinancialsPersonalTemplateItem } | { ok: false; error: string }
> {
  const { userId, fileBuffer, originalName, maxBytes = 16_000_000 } = params;

  if (!fileBuffer?.length) return { ok: false, error: "Empty file" };
  if (!looksLikeXlsx(originalName || "")) return { ok: false, error: "Please upload a .xlsx file." };
  if (fileBuffer.length > maxBytes) {
    return { ok: false, error: `File too large (max ${Math.round(maxBytes / 1_000_000)}MB).` };
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeOriginal = toSafeFilename(originalName || "historical-financials-template.xlsx");
  const filename = `${stamp} - ${safeOriginal}`;

  const t = workspaceTicker();
  const w = await workspaceWriteFile(userId, t, blobPath(filename), fileBuffer);
  if (!w.ok) return w;

  const item: HistoricalFinancialsPersonalTemplateItem = {
    id: `${stamp}-${Math.random().toString(16).slice(2)}`,
    filename,
    originalName: originalName || safeOriginal,
    savedAtIso: now.toISOString(),
    bytes: fileBuffer.length,
  };

  const manifest = await loadManifest(userId);
  manifest.unshift(item);
  await writeManifest(userId, manifest.slice(0, 20));

  return { ok: true, item };
}
