/**
 * Pull an embedded .xlsx workbook out of tab-prompt API markdown/text responses.
 * Models often return base64 inside fenced blocks or data URIs when asked for Excel output.
 */

function normalizeBase64(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
}

function tryDecodeBase64(raw: string): Uint8Array | null {
  const cleaned = normalizeBase64(raw.trim());
  if (cleaned.length < 64 || cleaned.length % 4 === 1) return null;
  try {
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Zip / OOXML workbook files start with PK. */
export function isLikelyXlsxBytes(bytes: Uint8Array | null | undefined): bytes is Uint8Array {
  if (!bytes || bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function firstValidXlsx(candidates: Array<Uint8Array | null>): ArrayBuffer | null {
  for (const c of candidates) {
    if (isLikelyXlsxBytes(c)) return toArrayBuffer(c);
  }
  return null;
}

/**
 * Returns an ArrayBuffer for the first valid embedded .xlsx found in `text`, or null.
 */
export function extractXlsxArrayBufferFromApiText(text: string): ArrayBuffer | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates: Array<Uint8Array | null> = [];

  const dataUri =
    /data:application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream);base64,([A-Za-z0-9+/=\s_-]+)/gi;
  for (const m of trimmed.matchAll(dataUri)) {
    candidates.push(tryDecodeBase64(m[1] ?? ""));
  }

  const fenceRe = /```(?:base64|xlsx|excel|spreadsheet|binary)?\s*\n([\s\S]*?)```/gi;
  for (const m of trimmed.matchAll(fenceRe)) {
    candidates.push(tryDecodeBase64(m[1] ?? ""));
  }

  const labeled =
    /(?:BASE64[_\s-]?XLSX|XLSX[_\s-]?BASE64|EXCEL[_\s-]?BASE64)\s*[:\n]\s*([A-Za-z0-9+/=\s_-]{200,})/gi;
  for (const m of trimmed.matchAll(labeled)) {
    candidates.push(tryDecodeBase64(m[1] ?? ""));
  }

  const runs = trimmed.match(/[A-Za-z0-9+/=\s_-]{400,}/g) ?? [];
  runs.sort((a, b) => b.length - a.length);
  for (const run of runs.slice(0, 8)) {
    candidates.push(tryDecodeBase64(run));
  }

  return firstValidXlsx(candidates);
}
