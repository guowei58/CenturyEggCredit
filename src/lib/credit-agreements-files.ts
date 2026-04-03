import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  workspaceDeleteFile,
  workspaceReadFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

export type CreditAgreementsFileItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
  contentType: string;
};

const SUBFOLDER_NAME = "Credit Agreements & Indentures";
const MANIFEST_FILE = "credit-agreements-files.json";

function manifestPath(): string {
  return `${SUBFOLDER_NAME}/${MANIFEST_FILE}`;
}

function blobPath(filename: string): string {
  return `${SUBFOLDER_NAME}/${filename}`;
}

function toSafeFilename(raw: string): string {
  const trimmed = (raw || "").trim();
  const extMatch = trimmed.match(/(\.[a-zA-Z0-9]{1,8})$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = trimmed
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const safeBase = base.length > 0 ? base.slice(0, 140) : "credit-document";
  return `${safeBase}${ext}`.trim() || "credit-document";
}

async function loadManifest(userId: string, safeTicker: string): Promise<CreditAgreementsFileItem[]> {
  const raw = await workspaceReadUtf8(userId, safeTicker, manifestPath());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CreditAgreementsFileItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(userId: string, safeTicker: string, items: CreditAgreementsFileItem[]): Promise<void> {
  await workspaceWriteUtf8(userId, safeTicker, manifestPath(), JSON.stringify(items, null, 2));
}

export async function listCreditAgreementsFiles(
  userId: string,
  ticker: string
): Promise<CreditAgreementsFileItem[] | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;
  const items = await loadManifest(userId, safeTicker);
  return items
    .filter((it) => it.ticker === safeTicker)
    .sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
}

export async function getCreditAgreementsFileBuffer(
  userId: string,
  ticker: string,
  filename: string
): Promise<{ buf: Buffer; item: CreditAgreementsFileItem | null } | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;
  const fn = filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) return null;
  const manifest = await loadManifest(userId, safeTicker);
  const item = manifest.find((it) => it.filename === fn) ?? null;
  const buf = await workspaceReadFile(userId, safeTicker, blobPath(fn));
  if (!buf) return null;
  return { buf, item };
}

export async function deleteCreditAgreementsFile(params: {
  userId: string;
  ticker: string;
  filename: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeTicker = sanitizeTicker(params.ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker or filename" };
  const fn = params.filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) {
    return { ok: false, error: "Invalid ticker or filename" };
  }

  await workspaceDeleteFile(params.userId, safeTicker, blobPath(fn));

  const manifest = await loadManifest(params.userId, safeTicker);
  const next = manifest.filter((it) => it.filename !== fn);
  await writeManifest(params.userId, safeTicker, next);
  return { ok: true };
}

export async function saveCreditAgreementsFile(params: {
  userId: string;
  ticker: string;
  fileBuffer: Buffer;
  originalName: string;
  contentType?: string;
  maxBytes?: number;
}): Promise<{ ok: true; item: CreditAgreementsFileItem } | { ok: false; error: string }> {
  const { userId, ticker, fileBuffer, originalName, contentType = "application/octet-stream", maxBytes = 20_000_000 } =
    params;
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  if (!fileBuffer || !fileBuffer.length) return { ok: false, error: "Empty file" };
  if (fileBuffer.length > maxBytes) return { ok: false, error: `File too large (max ${Math.round(maxBytes / 1_000_000)}MB).` };

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeOriginal = toSafeFilename(originalName || "credit-document");
  const filename = `${stamp} - ${safeOriginal}`;

  const w = await workspaceWriteFile(userId, safeTicker, blobPath(filename), fileBuffer);
  if (!w.ok) return w;

  const item: CreditAgreementsFileItem = {
    id: `${safeTicker}-${stamp}-${Math.random().toString(16).slice(2)}`,
    ticker: safeTicker,
    filename,
    originalName: originalName || safeOriginal,
    savedAtIso: now.toISOString(),
    bytes: fileBuffer.length,
    contentType,
  };

  const manifest = await loadManifest(userId, safeTicker);
  manifest.unshift(item);
  await writeManifest(userId, safeTicker, manifest.slice(0, 200));

  return { ok: true, item };
}
