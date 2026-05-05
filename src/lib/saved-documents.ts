import { getSecEdgarUserAgent } from "@/lib/sec-edgar";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  createUserSavedDocument,
  deleteUserSavedDocument,
  listUserSavedDocumentRows,
  upsertUserSavedDocument,
  type UserSavedDocumentListRow,
} from "@/lib/user-workspace-store";

export type SavedDocumentItem = {
  id: string;
  ticker: string;
  title: string;
  filename: string;
  relativePath: string;
  originalUrl: string;
  contentType: string | null;
  savedAtIso: string;
  bytes: number;
  convertedToPdf: boolean;
};

const SUBFOLDER_NAME = "Saved Documents";

/** Browser-like UA for non-SEC hosts (many sites block empty/generic bots). */
const BROWSER_LIKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function userAgentForRemoteSave(urlStr: string): string {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    if (host === "sec.gov" || host.endsWith(".sec.gov")) {
      return getSecEdgarUserAgent();
    }
  } catch {
    // ignore
  }
  return BROWSER_LIKE_UA;
}

function rowToSavedItem(row: UserSavedDocumentListRow): SavedDocumentItem {
  return {
    id: row.id,
    ticker: row.ticker,
    title: row.title,
    filename: row.filename,
    relativePath: `${SUBFOLDER_NAME}/${row.filename}`,
    originalUrl: row.originalUrl,
    contentType: row.contentType,
    savedAtIso: row.savedAtIso,
    bytes: row.bytes,
    convertedToPdf: row.convertedToPdf,
  };
}

export async function listSavedDocuments(userId: string, ticker: string): Promise<SavedDocumentItem[] | null> {
  const rows = await listUserSavedDocumentRows(userId, ticker);
  if (!rows) return null;
  return rows.map(rowToSavedItem).sort((a, b) => (a.savedAtIso < b.savedAtIso ? 1 : -1));
}

export async function reconcileSavedDocuments(userId: string, ticker: string): Promise<SavedDocumentItem[] | null> {
  return listSavedDocuments(userId, ticker);
}

/** Legacy disk import removed; returns current Postgres-backed list. */
export async function importTickerFilesIntoSavedDocuments(
  userId: string,
  ticker: string
): Promise<SavedDocumentItem[] | null> {
  return listSavedDocuments(userId, ticker);
}

function toSafeFilename(raw: string): string {
  const s = raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 140)
    .trim();
  return s.length > 0 ? s : "document";
}

function guessTitleFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const last = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return decodeURIComponent(last).replace(/\+/g, " ");
  } catch {
    return "document";
  }
}

function looksLikePdf(contentType: string | null, urlStr: string, head: Uint8Array | null): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/pdf")) return true;
  try {
    const u = new URL(urlStr);
    if (u.pathname.toLowerCase().endsWith(".pdf")) return true;
  } catch {
    // ignore
  }
  if (head && head.length >= 4) {
    const sig = String.fromCharCode(head[0], head[1], head[2], head[3]);
    if (sig === "%PDF") return true;
  }
  return false;
}

/** Parent directory of the document URL so saved HTML can resolve relative CSS/scripts/images. */
function documentFolderBaseUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    parts.pop();
    const dirPath = parts.length ? `/${parts.join("/")}/` : "/";
    return `${u.origin}${dirPath}`;
  } catch {
    return null;
  }
}

function injectBaseHrefIntoHtml(html: string, baseHref: string): string {
  if (/<base\s[^>]*\bhref\s*=/i.test(html)) return html;
  const escaped = baseHref.replace(/"/g, "&quot;");
  const baseTag = `<base href="${escaped}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseTag}</head><body>${html}</body></html>`;
}

function filenameStemFromSafeBase(safeBase: string): string {
  return toSafeFilename(safeBase.replace(/\.(pdf|html?|xml|txt|json)$/i, "") || "document");
}

function responseLooksLikeHtml(utf8: string, contentType: string | null, pageUrl: string): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return true;
  if (/\.html?($|[?#])/i.test(pageUrl)) return true;
  const head = utf8.slice(0, 8000).trimStart().toLowerCase();
  if (/<!doctype\s+html/i.test(head)) return true;
  if (/<\s*html[\s>]/.test(head)) return true;
  return false;
}

function bufferLooksBinary(buf: Buffer, maxScan = 8192): boolean {
  const n = Math.min(buf.length, maxScan);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function formatXml(xml: string): string {
  const tokens = xml.replace(/>\s*</g, "><").split(/(?=<)|(?<=>)/g).filter(Boolean);
  let depth = 0;
  const out: string[] = [];
  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;
    if (t.startsWith("</")) depth = Math.max(0, depth - 1);
    out.push(`${"  ".repeat(depth)}${t}`);
    if (t.startsWith("<") && !t.startsWith("</") && !t.endsWith("/>") && !t.startsWith("<?") && !t.startsWith("<!")) {
      depth += 1;
    }
  }
  return out.join("\n");
}

/**
 * Jina Reader fetches a URL and returns readable text. Format is `https://r.jina.ai/<targetUrl>`
 * with the full target URL (including https://) — not `.../http://host` only.
 * @see https://jina.ai/reader
 */
function jinaReaderMirrorCandidates(urlStr: string): string[] {
  let canonical: string;
  try {
    canonical = new URL(urlStr.trim()).href;
  } catch {
    return [];
  }
  const out: string[] = [];
  const push = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  push(`https://r.jina.ai/${canonical}`);
  try {
    const u = new URL(canonical);
    const rest = `${u.host}${u.pathname}${u.search}${u.hash}`;
    push(`https://r.jina.ai/http://${rest}`);
  } catch {
    // ignore
  }
  return out;
}

async function fetchViaReadableMirror(urlStr: string): Promise<string | null> {
  const candidates = jinaReaderMirrorCandidates(urlStr);
  if (!candidates.length) return null;

  for (const mirrorUrl of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(mirrorUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "text/plain,text/markdown;q=0.9,*/*;q=0.8",
          "User-Agent": BROWSER_LIKE_UA,
        },
      });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (text.length > 0) return text;
    } catch {
      // try next candidate
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/**
 * Store a client-generated SEC XBRL as-presented Excel workbook under Saved Documents for this ticker.
 * Filename is stable per ticker + filing (form, date, accession) so bulk or single save **replaces**
 * the same workbook instead of creating timestamped duplicates.
 */
export async function saveXbrlAsPresentedExcelToSavedDocuments(
  userId: string,
  ticker: string,
  filing: { form: string; filingDate: string; accessionNumber: string },
  xlsxBuffer: Buffer
): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };
  if (xlsxBuffer.length < 64) return { ok: false, error: "Invalid spreadsheet payload." };
  const head = xlsxBuffer.subarray(0, 4);
  const sig = String.fromCharCode(head[0] ?? 0, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0);
  if (sig !== "PK\u0003\u0004") {
    return { ok: false, error: "File must be a valid .xlsx workbook." };
  }

  const now = new Date();
  const acc = filing.accessionNumber.replace(/[^\w-]+/g, "_");
  const form = toSafeFilename((filing.form || "FILING").trim());
  const fdate = toSafeFilename((filing.filingDate || "nodate").trim());
  const slug = toSafeFilename(`${safeTicker}_SEC-XBRL-financials_as-presented_${form}_${fdate}_${acc}`);
  const filename = `${slug}.xlsx`;
  const titleRaw = `${safeTicker} SEC XBRL financials (as-presented) · ${filing.form} ${filing.filingDate}`;
  const title = toSafeFilename(titleRaw).slice(0, 140) || slug;
  const originalUrl = `app:sec-xbrl-as-presented/${encodeURIComponent(safeTicker)}/${encodeURIComponent(filing.accessionNumber)}`;

  const saved = await upsertUserSavedDocument(userId, safeTicker, {
    filename,
    title,
    originalUrl,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: xlsxBuffer,
    savedAtIso: now.toISOString(),
    convertedToPdf: false,
  });
  if (!saved.ok) return saved;

  const item: SavedDocumentItem = {
    id: saved.id,
    ticker: safeTicker,
    title,
    filename,
    relativePath: `${SUBFOLDER_NAME}/${filename}`,
    originalUrl,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    savedAtIso: now.toISOString(),
    bytes: xlsxBuffer.length,
    convertedToPdf: false,
  };
  return { ok: true, item };
}

/**
 * Store the deterministic XBRL compiler Excel export. One stable filename per ticker so each run replaces the latest compiled model.
 */
export async function saveDeterministicCompilerExcelToSavedDocuments(
  userId: string,
  ticker: string,
  xlsxBuffer: Buffer
): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };
  if (xlsxBuffer.length < 64) return { ok: false, error: "Invalid spreadsheet payload." };
  const head = xlsxBuffer.subarray(0, 4);
  const sig = String.fromCharCode(head[0] ?? 0, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0);
  if (sig !== "PK\u0003\u0004") {
    return { ok: false, error: "File must be a valid .xlsx workbook." };
  }

  const now = new Date();
  const slug = toSafeFilename(`${safeTicker}_XBRL-deterministic-compiled-financials`);
  const filename = `${slug}.xlsx`;
  const titleRaw = `${safeTicker} XBRL deterministic compiled financials`;
  const title = toSafeFilename(titleRaw).slice(0, 140) || slug;
  const originalUrl = `app:xbrl-deterministic-compiler/${encodeURIComponent(safeTicker)}`;

  const saved = await upsertUserSavedDocument(userId, safeTicker, {
    filename,
    title,
    originalUrl,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: xlsxBuffer,
    savedAtIso: now.toISOString(),
    convertedToPdf: false,
  });
  if (!saved.ok) return saved;

  const item: SavedDocumentItem = {
    id: saved.id,
    ticker: safeTicker,
    title,
    filename,
    relativePath: `${SUBFOLDER_NAME}/${filename}`,
    originalUrl,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    savedAtIso: now.toISOString(),
    bytes: xlsxBuffer.length,
    convertedToPdf: false,
  };
  return { ok: true, item };
}

async function persistSavedDocumentFromUrl(
  userId: string,
  safeTicker: string,
  params: {
    sourceUrl: string;
    body: Buffer;
    filename: string;
    title: string;
    contentType: string | null;
    convertedToPdf: boolean;
    savedAtIso: string;
  }
): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> {
  const created = await createUserSavedDocument(userId, safeTicker, {
    filename: params.filename,
    title: params.title,
    originalUrl: params.sourceUrl,
    contentType: params.contentType,
    body: params.body,
    savedAtIso: params.savedAtIso,
    convertedToPdf: params.convertedToPdf,
  });
  if (!created.ok) return created;
  return {
    ok: true,
    item: {
      id: created.id,
      ticker: safeTicker,
      title: params.title,
      filename: params.filename,
      relativePath: `${SUBFOLDER_NAME}/${params.filename}`,
      originalUrl: params.sourceUrl,
      contentType: params.contentType,
      savedAtIso: params.savedAtIso,
      bytes: params.body.length,
      convertedToPdf: params.convertedToPdf,
    },
  };
}

async function persistUpsertedDocumentFromUrl(
  userId: string,
  safeTicker: string,
  params: {
    sourceUrl: string;
    body: Buffer;
    filename: string;
    title: string;
    contentType: string | null;
    convertedToPdf: boolean;
    savedAtIso: string;
  }
): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> {
  const saved = await upsertUserSavedDocument(userId, safeTicker, {
    filename: params.filename,
    title: params.title,
    originalUrl: params.sourceUrl,
    contentType: params.contentType,
    body: params.body,
    savedAtIso: params.savedAtIso,
    convertedToPdf: params.convertedToPdf,
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    item: {
      id: saved.id,
      ticker: safeTicker,
      title: params.title,
      filename: params.filename,
      relativePath: `${SUBFOLDER_NAME}/${params.filename}`,
      originalUrl: params.sourceUrl,
      contentType: params.contentType,
      savedAtIso: params.savedAtIso,
      bytes: params.body.length,
      convertedToPdf: params.convertedToPdf,
    },
  };
}

/** Upsert raw bytes from an SEC Archives exhibit into Saved Documents (same filename replaces a prior run). */
export async function upsertSecArchivesExhibitAsSavedDocument(
  userId: string,
  ticker: string,
  params: {
    sourceUrl: string;
    filename: string;
    title: string;
    body: Buffer;
    contentType: string | null;
  }
): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };
  const savedAtIso = new Date().toISOString();
  return persistUpsertedDocumentFromUrl(userId, safeTicker, {
    sourceUrl: params.sourceUrl,
    body: params.body,
    filename: params.filename,
    title: params.title,
    contentType: params.contentType,
    convertedToPdf: false,
    savedAtIso,
  });
}

export async function saveDocumentFromUrl(
  userId: string,
  ticker: string,
  urlStr: string
): Promise<
  | { ok: true; item: SavedDocumentItem }
  | { ok: false; error: string }
> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  let url: URL;
  try {
    url = new URL(urlStr.trim());
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "URL must be http(s)" };
  }

  const saveUa = userAgentForRemoteSave(url.toString());
  const fetchAttempts: HeadersInit[] = [
    // First attempt: browser-like request profile to reduce 403 blocks on HTML pages.
    {
      "User-Agent": saveUa,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
    },
    // Second attempt: minimal headers (some hosts block nonstandard combinations; SEC still needs a proper UA).
    { "User-Agent": saveUa },
  ];

  let res: Response | null = null;
  let lastStatus: number | null = null;
  let lastFetchError: string | null = null;

  const hostLower = url.hostname.toLowerCase();
  const fetchTimeoutMs =
    hostLower === "sec.gov" || hostLower.endsWith(".sec.gov") ? 55_000 : 25_000;

  for (const headers of fetchAttempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const attempt = await fetch(url.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers,
      });

      if (attempt.ok) {
        res = attempt;
        break;
      }
      lastStatus = attempt.status;

      // Retry on auth/forbidden/rate-limit classes where header shape can matter.
      if (![401, 403, 406, 429].includes(attempt.status)) {
        res = attempt;
        break;
      }
    } catch (e) {
      lastFetchError = e instanceof Error ? e.message : "Fetch failed";
    } finally {
      clearTimeout(timeout);
    }
  }

  const now = new Date();
  const savedAtIso = now.toISOString();
  const stamp = savedAtIso.replace(/[:.]/g, "-");
  const baseTitle = guessTitleFromUrl(url.toString());
  const safeBase = toSafeFilename(baseTitle);
  const stem = filenameStemFromSafeBase(safeBase);

  const tryMirrorReaderSnapshot = async (): Promise<
    { ok: true; item: SavedDocumentItem } | { ok: false; error: string } | null
  > => {
    const mirroredText = await fetchViaReadableMirror(url.toString());
    if (!mirroredText?.trim()) return null;
    const header = `Source: ${url.toString()}\nSaved: ${savedAtIso}\n\n---\n\n`;
    const body = Buffer.from(header + mirroredText.slice(0, 450_000), "utf8");
    const txtFilename = `${stamp} - ${stem}-reader-snapshot.txt`;
    return persistSavedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: url.toString(),
      body,
      filename: txtFilename,
      title: safeBase,
      contentType: "text/plain; charset=utf-8",
      convertedToPdf: false,
      savedAtIso,
    });
  };

  if (!res) {
    const mirrorFallback = await tryMirrorReaderSnapshot();
    if (mirrorFallback) return mirrorFallback;
    const baseMsg =
      lastFetchError ??
      (lastStatus != null ? `HTTP ${lastStatus}` : "Fetch failed");
    if (lastStatus === 403 || lastStatus === 401) {
      return {
        ok: false,
        error: `${baseMsg} — the host denied access from this server (common for cloud IPs vs SEC.gov). Set SEC_EDGAR_USER_AGENT in Vercel (app name + email; a bare email is auto-prefixed), redeploy, and try again; or use a direct .pdf exhibit link when available.`,
      };
    }
    const helpful =
      baseMsg.toLowerCase().includes("fetch failed") || baseMsg.toLowerCase().includes("network")
        ? `${baseMsg} — the server could not download the URL. This host may block automated requests. Try a direct SEC exhibit/PDF URL or another public source URL.`
        : baseMsg;
    return { ok: false, error: helpful };
  }

  if (!res.ok) {
    if (res.status === 403 || lastStatus === 403) {
      const mirror403 = await tryMirrorReaderSnapshot();
      if (mirror403) return mirror403;
      return {
        ok: false,
        error:
          "Fetch failed (HTTP 403) — this site likely blocks automated/server requests. Try a direct SEC exhibit/PDF link or another public source URL.",
      };
    }
    return { ok: false, error: `Fetch failed (HTTP ${res.status})` };
  }

  const resContentType = res.headers.get("content-type");
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const head = buf.subarray(0, 8);
  const finalFetchedUrl = res.url || url.toString();

  if (looksLikePdf(resContentType, url.toString(), head)) {
    const pdfFilename = `${stamp} - ${stem}.pdf`;
    return persistSavedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: buf,
      filename: pdfFilename,
      title: safeBase,
      contentType: resContentType?.includes("pdf") ? resContentType : "application/pdf",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  const textCt = (resContentType || "").toLowerCase();
  let utf8: string;
  try {
    utf8 = buf.toString("utf8");
  } catch {
    utf8 = "";
  }

  if (responseLooksLikeHtml(utf8, resContentType, finalFetchedUrl)) {
    const folderBase = documentFolderBaseUrl(finalFetchedUrl);
    const htmlBody = folderBase ? injectBaseHrefIntoHtml(utf8, folderBase) : utf8;
    const htmlFilename = `${stamp} - ${stem}.html`;
    const htmlBuf = Buffer.from(htmlBody, "utf8");
    return persistSavedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: htmlBuf,
      filename: htmlFilename,
      title: safeBase,
      contentType: "text/html; charset=utf-8",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  const looksXml =
    textCt.includes("xml") ||
    textCt.includes("text/xml") ||
    /^\s*<\?xml/i.test(utf8);

  if (looksXml && utf8.length > 0 && !bufferLooksBinary(buf)) {
    const xmlBody = formatXml(utf8).slice(0, 2_000_000);
    const xmlFilename = `${stamp} - ${stem}.xml`;
    return persistSavedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: Buffer.from(xmlBody, "utf8"),
      filename: xmlFilename,
      title: safeBase,
      contentType: "application/xml; charset=utf-8",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  if (bufferLooksBinary(buf)) {
    const binFilename = `${stamp} - ${stem}.bin`;
    return persistSavedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: buf,
      filename: binFilename,
      title: safeBase,
      contentType: resContentType || "application/octet-stream",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  const txtFilename = `${stamp} - ${stem}.txt`;
  return persistSavedDocumentFromUrl(userId, safeTicker, {
    sourceUrl: finalFetchedUrl,
    body: Buffer.from(utf8.slice(0, 2_000_000), "utf8"),
    filename: txtFilename,
    title: safeBase,
    contentType: "text/plain; charset=utf-8",
    convertedToPdf: false,
    savedAtIso,
  });
}

/** Stable filenames under Saved Documents so SEC ingest can replace the same logical filing on refresh. */
export const SEC_SAVED_DOC_PRIMARY_BASE = "SEC-latest-annual-primary";
export const SEC_SAVED_DOC_EXHIBIT21_BASE = "SEC-Exhibit-21-subsidiaries";

/**
 * Like {@link saveDocumentFromUrl} but upserts `filenameBase` + extension so repeat saves replace one row.
 */
export async function upsertDocumentFromUrl(
  userId: string,
  ticker: string,
  urlStr: string,
  filenameBase: string
): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  let url: URL;
  try {
    url = new URL(urlStr.trim());
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "URL must be http(s)" };
  }

  const saveUa = userAgentForRemoteSave(url.toString());
  const fetchAttempts: HeadersInit[] = [
    {
      "User-Agent": saveUa,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
    },
    { "User-Agent": saveUa },
  ];

  let res: Response | null = null;
  let lastStatus: number | null = null;
  let lastFetchError: string | null = null;

  const hostLower = url.hostname.toLowerCase();
  const fetchTimeoutMs =
    hostLower === "sec.gov" || hostLower.endsWith(".sec.gov") ? 55_000 : 25_000;

  for (const headers of fetchAttempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const attempt = await fetch(url.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers,
      });

      if (attempt.ok) {
        res = attempt;
        break;
      }
      lastStatus = attempt.status;

      if (![401, 403, 406, 429].includes(attempt.status)) {
        res = attempt;
        break;
      }
    } catch (e) {
      lastFetchError = e instanceof Error ? e.message : "Fetch failed";
    } finally {
      clearTimeout(timeout);
    }
  }

  const now = new Date();
  const savedAtIso = now.toISOString();
  const fb = toSafeFilename(filenameBase.trim());
  const safeBase = fb.length > 0 ? fb : "document";
  const stem = filenameStemFromSafeBase(safeBase);

  const tryMirrorReaderSnapshot = async (): Promise<
    { ok: true; item: SavedDocumentItem } | { ok: false; error: string } | null
  > => {
    const mirroredText = await fetchViaReadableMirror(url.toString());
    if (!mirroredText?.trim()) return null;
    const header = `Source: ${url.toString()}\nSaved: ${savedAtIso}\n\n---\n\n`;
    const body = Buffer.from(header + mirroredText.slice(0, 450_000), "utf8");
    const txtFilename = `${stem}-reader-snapshot.txt`;
    return persistUpsertedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: url.toString(),
      body,
      filename: txtFilename,
      title: safeBase,
      contentType: "text/plain; charset=utf-8",
      convertedToPdf: false,
      savedAtIso,
    });
  };

  if (!res) {
    const mirrorFallback = await tryMirrorReaderSnapshot();
    if (mirrorFallback) return mirrorFallback;
    const baseMsg =
      lastFetchError ??
      (lastStatus != null ? `HTTP ${lastStatus}` : "Fetch failed");
    if (lastStatus === 403 || lastStatus === 401) {
      return {
        ok: false,
        error: `${baseMsg} — the host denied access from this server (common for cloud IPs vs SEC.gov). Set SEC_EDGAR_USER_AGENT in Vercel (app name + email; a bare email is auto-prefixed), redeploy, and try again; or use a direct .pdf exhibit link when available.`,
      };
    }
    const helpful =
      baseMsg.toLowerCase().includes("fetch failed") || baseMsg.toLowerCase().includes("network")
        ? `${baseMsg} — the server could not download the URL. This host may block automated requests. Try a direct SEC exhibit/PDF URL or another public source URL.`
        : baseMsg;
    return { ok: false, error: helpful };
  }

  if (!res.ok) {
    if (res.status === 403 || lastStatus === 403) {
      const mirror403 = await tryMirrorReaderSnapshot();
      if (mirror403) return mirror403;
      return {
        ok: false,
        error:
          "Fetch failed (HTTP 403) — this site likely blocks automated/server requests. Try a direct SEC exhibit/PDF link or another public source URL.",
      };
    }
    return { ok: false, error: `Fetch failed (HTTP ${res.status})` };
  }

  const resContentType = res.headers.get("content-type");
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const head = buf.subarray(0, 8);
  const finalFetchedUrl = res.url || url.toString();

  if (looksLikePdf(resContentType, url.toString(), head)) {
    const pdfFilename = `${stem}.pdf`;
    return persistUpsertedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: buf,
      filename: pdfFilename,
      title: safeBase,
      contentType: resContentType?.includes("pdf") ? resContentType : "application/pdf",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  const textCt = (resContentType || "").toLowerCase();
  let utf8: string;
  try {
    utf8 = buf.toString("utf8");
  } catch {
    utf8 = "";
  }

  if (responseLooksLikeHtml(utf8, resContentType, finalFetchedUrl)) {
    const folderBase = documentFolderBaseUrl(finalFetchedUrl);
    const htmlBody = folderBase ? injectBaseHrefIntoHtml(utf8, folderBase) : utf8;
    const htmlFilename = `${stem}.html`;
    const htmlBuf = Buffer.from(htmlBody, "utf8");
    return persistUpsertedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: htmlBuf,
      filename: htmlFilename,
      title: safeBase,
      contentType: "text/html; charset=utf-8",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  const looksXml =
    textCt.includes("xml") ||
    textCt.includes("text/xml") ||
    /^\s*<\?xml/i.test(utf8);

  if (looksXml && utf8.length > 0 && !bufferLooksBinary(buf)) {
    const xmlBody = formatXml(utf8).slice(0, 2_000_000);
    const xmlFilename = `${stem}.xml`;
    return persistUpsertedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: Buffer.from(xmlBody, "utf8"),
      filename: xmlFilename,
      title: safeBase,
      contentType: "application/xml; charset=utf-8",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  if (bufferLooksBinary(buf)) {
    const binFilename = `${stem}.bin`;
    return persistUpsertedDocumentFromUrl(userId, safeTicker, {
      sourceUrl: finalFetchedUrl,
      body: buf,
      filename: binFilename,
      title: safeBase,
      contentType: resContentType || "application/octet-stream",
      convertedToPdf: false,
      savedAtIso,
    });
  }

  const txtFilename = `${stem}.txt`;
  return persistUpsertedDocumentFromUrl(userId, safeTicker, {
    sourceUrl: finalFetchedUrl,
    body: Buffer.from(utf8.slice(0, 2_000_000), "utf8"),
    filename: txtFilename,
    title: safeBase,
    contentType: "text/plain; charset=utf-8",
    convertedToPdf: false,
    savedAtIso,
  });
}

function looksSafeFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return false;
  // Filenames generated by us are like: `${stamp} - ${stem}.html` / `.pdf` / `.txt`
  if (filename.length > 220) return false;
  return true;
}

export async function deleteSavedDocument(
  userId: string,
  ticker: string,
  filename: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fn = filename.trim();
  if (!looksSafeFilename(fn)) return { ok: false, error: "Invalid file" };
  return deleteUserSavedDocument(userId, ticker, fn);
}

