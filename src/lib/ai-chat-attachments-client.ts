/**
 * Client-only helpers for AI Chat file attachments (images + PDF).
 */

const MAX_BYTES_PER_FILE = 5 * 1024 * 1024;

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function guessMimeFromName(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "";
}

export function readFileAsBase64Raw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const d = String(r.result ?? "");
      const idx = d.indexOf("base64,");
      resolve(idx >= 0 ? d.slice(idx + 7) : d);
    };
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

export type PreparedAttachment =
  | { ok: true; name: string; mediaType: string; data: string }
  | { ok: false; error: string };

export async function prepareFileForAiChat(file: File): Promise<PreparedAttachment> {
  if (file.size > MAX_BYTES_PER_FILE) {
    return { ok: false, error: `${file.name} is too large (max 5 MB per file).` };
  }
  let mediaType = (file.type || guessMimeFromName(file.name)).toLowerCase();
  if (!mediaType || mediaType === "application/octet-stream") {
    mediaType = guessMimeFromName(file.name);
  }
  if (mediaType !== "application/pdf" && !IMAGE_MIME.has(mediaType)) {
    return {
      ok: false,
      error: `${file.name}: use PDF or an image (JPEG, PNG, GIF, WebP), or paste plain text.`,
    };
  }
  try {
    const data = await readFileAsBase64Raw(file);
    return { ok: true, name: file.name || "file", mediaType, data };
  } catch {
    return { ok: false, error: `Could not read ${file.name}.` };
  }
}

const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".log", ".xml", ".html", ".htm"]);

export function isLikelyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const n = file.name.toLowerCase();
  const dot = n.lastIndexOf(".");
  const ext = dot >= 0 ? n.slice(dot) : "";
  return TEXT_EXT.has(ext);
}

/**
 * Files from a paste or drop event. Screenshots on Windows/macOS often appear under
 * {@link DataTransferItem} (`kind === "file"`) while {@link DataTransfer#files} stays empty.
 */
export function getClipboardOrDropFiles(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length > 0) {
    return Array.from(dt.files);
  }
  const items = dt.items;
  if (!items?.length) return [];
  const out: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

export function readTextFileForAppend(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isLikelyTextFile(file)) {
      resolve(null);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      resolve(null);
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsText(file);
  });
}
