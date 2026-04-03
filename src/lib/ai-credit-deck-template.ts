import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  workspaceReadFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

export type AiCreditDeckTemplateItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

const SUBFOLDER_NAME = "AI Credit Deck Templates";
const MANIFEST_FILE = "ai-credit-deck-templates.json";

function manifestPath(): string {
  return `${SUBFOLDER_NAME}/${MANIFEST_FILE}`;
}

function blobPath(filename: string): string {
  return `${SUBFOLDER_NAME}/${filename}`;
}

function looksLikeDeckFile(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".pptx") || n.endsWith(".ppt");
}

function toSafeFilename(raw: string): string {
  const trimmed = (raw || "").trim();
  const ext = trimmed.toLowerCase().endsWith(".ppt") ? ".ppt" : ".pptx";
  const base = trimmed
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const safeBase = base.length > 0 ? base.slice(0, 120) : "ai-credit-deck-template";
  return `${safeBase}${ext}`;
}

async function loadManifest(userId: string, safeTicker: string): Promise<AiCreditDeckTemplateItem[]> {
  const raw = await workspaceReadUtf8(userId, safeTicker, manifestPath());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AiCreditDeckTemplateItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(userId: string, safeTicker: string, items: AiCreditDeckTemplateItem[]): Promise<void> {
  await workspaceWriteUtf8(userId, safeTicker, manifestPath(), JSON.stringify(items, null, 2));
}

export async function listAiCreditDeckTemplates(
  userId: string,
  ticker: string
): Promise<AiCreditDeckTemplateItem[] | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;
  const items = await loadManifest(userId, safeTicker);
  return items.filter((it) => it.ticker === safeTicker).sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
}

export async function getAiCreditDeckTemplateBuffer(
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

export async function saveAiCreditDeckTemplateFile(params: {
  userId: string;
  ticker: string;
  fileBuffer: Buffer;
  originalName: string;
  maxBytes?: number;
}): Promise<{ ok: true; item: AiCreditDeckTemplateItem } | { ok: false; error: string }> {
  const { userId, ticker, fileBuffer, originalName, maxBytes = 30_000_000 } = params;
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  if (!fileBuffer || !fileBuffer.length) return { ok: false, error: "Empty file" };
  if (!looksLikeDeckFile(originalName || "")) return { ok: false, error: "Please upload a .ppt or .pptx file." };
  if (fileBuffer.length > maxBytes) return { ok: false, error: `File too large (max ${Math.round(maxBytes / 1_000_000)}MB).` };

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeOriginal = toSafeFilename(originalName || "ai-credit-deck-template.pptx");
  const filename = `${stamp} - ${safeOriginal}`;

  const w = await workspaceWriteFile(userId, safeTicker, blobPath(filename), fileBuffer);
  if (!w.ok) return w;

  const item: AiCreditDeckTemplateItem = {
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
