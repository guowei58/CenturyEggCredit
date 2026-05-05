import { Buffer } from "node:buffer";

/**
 * Lightweight text extraction — structured PDF OCR is intentionally out of scope for this pass.
 */
export function parseCreditDocumentToPlainText(bytes: Uint8Array | Buffer): string {
  const slice = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const asUtf8 = slice.toString("utf8").replace(/\u0000/g, " ");
  if (asUtf8.startsWith("%PDF")) return "";
  return asUtf8.slice(0, 1_250_000);
}
