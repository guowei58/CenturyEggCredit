import { clipText, stripHtmlToDebtPlainText } from "@/lib/debt-map/textExtractor";
import { MAX_PDF_PAGES_DEBT_MAP, MAX_RAW_TEXT_CHARS, SEC_REQUEST_GAP_MS } from "@/lib/debt-map/constants";
import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

let lastSecRequestAt = 0;

async function paceSec(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, SEC_REQUEST_GAP_MS - (now - lastSecRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSecRequestAt = Date.now();
}

export type FetchedDocument = {
  text: string;
  contentType: string;
  ok: boolean;
  error?: string;
};

/** Raw bytes from SEC Archives (no PDF/HTML text extraction). Uses EDGAR pacing + identity UA. */
export async function fetchSecArchivesRaw(url: string): Promise<
  { ok: true; buffer: Buffer; contentType: string | null } | { ok: false; error: string }
> {
  await paceSec();
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  try {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer, contentType: res.headers.get("content-type") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "read body failed" };
  }
}

export async function downloadAndExtractSecDocument(url: string): Promise<FetchedDocument> {
  await paceSec();
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  } catch (e) {
    return { text: "", contentType: "", ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
  if (!res.ok) {
    return { text: "", contentType: res.headers.get("content-type") ?? "", ok: false, error: `${res.status}` };
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();

  if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(url)) {
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const tr = await parser.getText({ first: MAX_PDF_PAGES_DEBT_MAP });
        const text = clipText((tr.text || "").trim(), MAX_RAW_TEXT_CHARS);
        return { text, contentType: "application/pdf", ok: text.length > 0 };
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } catch (e) {
      return { text: "", contentType: "application/pdf", ok: false, error: e instanceof Error ? e.message : "pdf" };
    }
  }

  if (ct.includes("html") || ct.includes("text") || /\.(htm|html|txt)(\?|$)/i.test(url)) {
    const raw = await res.text();
    const text = clipText(
      stripHtmlToDebtPlainText(raw.includes("<html") || raw.includes("<HTML") ? raw : raw),
      MAX_RAW_TEXT_CHARS
    );
    return { text, contentType: ct || "text/html", ok: text.length > 0 };
  }

  // Unknown: try as text
  const raw = await res.text();
  const text = clipText(stripHtmlToDebtPlainText(raw), MAX_RAW_TEXT_CHARS);
  return { text, contentType: ct || "unknown", ok: text.length > 20, error: text.length <= 20 ? "empty or binary" : undefined };
}
