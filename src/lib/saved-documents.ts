import fs from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { chromium } from "playwright";
import { SEC_EDGAR_USER_AGENT } from "@/lib/sec-edgar";
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
      const fromEnv = process.env.SEC_EDGAR_USER_AGENT?.trim();
      return fromEnv && fromEnv.length > 8 ? fromEnv : SEC_EDGAR_USER_AGENT;
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

function stripHtmlToText(html: string): string {
  const noScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
  const noStyles = noScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  const tableAware = noStyles
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<tr[^>]*>/gi, "")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<t[dh][^>]*>/gi, "")
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ");
  const noTags = tableAware.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(noTags)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(?:\s*\|\s*){2,}/g, " | ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
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

async function pdfFromText(params: { title: string; url: string; text: string }): Promise<Buffer> {
  await ensurePdfkitFontMetricsAvailable();
  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const stream = new PassThrough();
  const bufs: Buffer[] = [];
  stream.on("data", (b) => bufs.push(b as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(bufs)));
    stream.on("error", reject);
  });

  doc.pipe(stream);
  doc.fontSize(16).fillColor("#111111").text(params.title, { underline: false });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666666").text(params.url, { link: params.url, underline: true });
  doc.moveDown(1);
  doc.fontSize(10).fillColor("#111111").text(params.text || "(No text could be extracted.)", {
    lineGap: 2,
  });
  doc.end();

  return await done;
}

async function pdfFromRenderedHtmlUrl(url: string): Promise<Buffer> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage({
      userAgent: userAgentForRemoteSave(url),
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    return await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

async function pdfFromRenderedHtmlContent(params: { url: string; html: string }): Promise<Buffer> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage({
      userAgent: userAgentForRemoteSave(params.url),
    });
    // Provide a base URL so relative CSS/asset paths resolve correctly.
    const htmlWithBase = /<head[^>]*>/i.test(params.html)
      ? params.html.replace(/<head([^>]*)>/i, `<head$1><base href="${params.url}">`)
      : `<head><base href="${params.url}"></head>${params.html}`;
    await page.setContent(htmlWithBase, { waitUntil: "networkidle", timeout: 45_000 });
    return await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

async function ensurePdfkitFontMetricsAvailable(): Promise<void> {
  // If PDFKit is webpack-bundled, it resolves AFM files under `.next/server/chunks/data/` (broken __dirname).
  // Prefer `serverComponentsExternalPackages: ['pdfkit']` in next.config.js so `__dirname` stays `.../pdfkit/js`.
  // This copy is a dev / fallback safety net when source exists (e.g. local node_modules).
  const sourceDir = path.join(process.cwd(), "node_modules", "pdfkit", "js", "data");
  const targetDirs = [
    path.join(process.cwd(), ".next", "server", "chunks", "data"),
    path.join(process.cwd(), ".next", "server", "vendor-chunks", "data"),
  ];

  try {
    const stat = await fs.stat(sourceDir);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(sourceDir);
  } catch {
    return;
  }

  const afmFiles = entries.filter((name) => name.toLowerCase().endsWith(".afm"));
  for (const targetDir of targetDirs) {
    await fs.mkdir(targetDir, { recursive: true });
    for (const name of afmFiles) {
      const src = path.join(sourceDir, name);
      const dst = path.join(targetDir, name);
      try {
        await fs.access(dst);
        continue;
      } catch {
        // missing in target, copy it
      }
      try {
        await fs.copyFile(src, dst);
      } catch {
        // best effort
      }
    }
  }
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

  for (const headers of fetchAttempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
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
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const baseTitle = guessTitleFromUrl(url.toString());
  const safeBase = toSafeFilename(baseTitle);
  const filename = `${stamp} - ${safeBase}.pdf`;

  let convertedToPdf = false;
  let contentType: string | null = null;

  const persistBuffer = async (
    sourceUrl: string,
    pdfBuf: Buffer,
    opts?: { contentType?: string | null; converted?: boolean }
  ): Promise<{ ok: true; item: SavedDocumentItem } | { ok: false; error: string }> => {
    const ct = opts?.contentType ?? contentType;
    const conv = opts?.converted ?? convertedToPdf;
    const created = await createUserSavedDocument(userId, safeTicker, {
      filename,
      title: safeBase,
      originalUrl: sourceUrl,
      contentType: ct,
      body: pdfBuf,
      savedAtIso: now.toISOString(),
      convertedToPdf: conv,
    });
    if (!created.ok) return created;
    const item: SavedDocumentItem = {
      id: created.id,
      ticker: safeTicker,
      title: safeBase,
      filename,
      relativePath: `${SUBFOLDER_NAME}/${filename}`,
      originalUrl: sourceUrl,
      contentType: ct,
      savedAtIso: now.toISOString(),
      bytes: pdfBuf.length,
      convertedToPdf: conv,
    };
    return { ok: true, item };
  };

  const tryRenderUrlDirectly = async (): Promise<
    { ok: true; item: SavedDocumentItem } | { ok: false; error: string } | null
  > => {
    try {
      const rendered = await pdfFromRenderedHtmlUrl(url.toString());
      convertedToPdf = true;
      contentType = "application/pdf";
      return persistBuffer(url.toString(), rendered, { contentType: "application/pdf", converted: true });
    } catch {
      return null;
    }
  };

  const tryReadableMirrorFallback = async (): Promise<
    { ok: true; item: SavedDocumentItem } | { ok: false; error: string } | null
  > => {
    try {
      const mirroredText = await fetchViaReadableMirror(url.toString());
      if (!mirroredText) return null;
      const pdfBuf = await pdfFromText({
        title: safeBase,
        url: url.toString(),
        text: mirroredText.slice(0, 300_000),
      });
      convertedToPdf = true;
      contentType = "application/pdf";
      return persistBuffer(url.toString(), pdfBuf, { contentType: "application/pdf", converted: true });
    } catch {
      return null;
    }
  };

  if (!res) {
    // Prefer Jina Reader before Playwright: serverless hosts usually cannot run Chromium; mirror is cheap HTTP.
    const mirrorFallback = await tryReadableMirrorFallback();
    if (mirrorFallback) return mirrorFallback;
    const browserFallback = await tryRenderUrlDirectly();
    if (browserFallback) return browserFallback;
    const baseMsg =
      lastFetchError ??
      (lastStatus != null ? `HTTP ${lastStatus}` : "Fetch failed");
    if (lastStatus === 403 || lastStatus === 401) {
      return {
        ok: false,
        error: `${baseMsg} — the host denied access from this server (common for cloud IPs vs SEC.gov). Set SEC_EDGAR_USER_AGENT on production to a descriptive value with a contact email, redeploy, and try again; or use a direct .pdf exhibit link when available.`,
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
      const browserFallback = await tryRenderUrlDirectly();
      if (browserFallback) return browserFallback;
      const mirrorFallback = await tryReadableMirrorFallback();
      if (mirrorFallback) return mirrorFallback;
      return {
        ok: false,
        error:
          "Fetch failed (HTTP 403) — this site likely blocks automated/server requests. Try a direct SEC exhibit/PDF link or another public source URL.",
      };
    }
    return { ok: false, error: `Fetch failed (HTTP ${res.status})` };
  }

  contentType = res.headers.get("content-type");
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const head = buf.subarray(0, 8);
  const isPdf = looksLikePdf(contentType, url.toString(), head);

  if (isPdf) {
    return persistBuffer(res.url || url.toString(), buf, { contentType, converted: false });
  }

  const textCt = (contentType || "").toLowerCase();
  const utf8 = buf.toString("utf8");
  const finalFetchedUrl = res.url || url.toString();
  const looksHtml =
    textCt.includes("text/html") ||
    textCt.includes("application/xhtml") ||
    /\.html?($|[?#])/i.test(finalFetchedUrl);

  if (looksHtml) {
    try {
      const rendered = await pdfFromRenderedHtmlContent({ url: finalFetchedUrl, html: utf8 });
      convertedToPdf = true;
      contentType = "application/pdf";
      return persistBuffer(finalFetchedUrl, rendered, { contentType: "application/pdf", converted: true });
    } catch {
      try {
        const rendered = await pdfFromRenderedHtmlUrl(finalFetchedUrl);
        convertedToPdf = true;
        contentType = "application/pdf";
        return persistBuffer(finalFetchedUrl, rendered, { contentType: "application/pdf", converted: true });
      } catch {
        const rawText = stripHtmlToText(utf8);
        const pdfBuf = await pdfFromText({
          title: safeBase,
          url: finalFetchedUrl,
          text: rawText.slice(0, 200_000),
        });
        convertedToPdf = true;
        contentType = "application/pdf";
        return persistBuffer(finalFetchedUrl, pdfBuf, { contentType: "application/pdf", converted: true });
      }
    }
  }

  const looksXml = textCt.includes("xml") || /^\s*<\?xml/i.test(utf8) || /^\s*<\w+[\s>]/i.test(utf8);
  const rawText = looksXml ? formatXml(utf8) : utf8;
  const pdfBuf = await pdfFromText({
    title: safeBase,
    url: url.toString(),
    text: rawText.slice(0, 200_000),
  });
  convertedToPdf = true;
  contentType = "application/pdf";
  return persistBuffer(url.toString(), pdfBuf, { contentType: "application/pdf", converted: true });
}

function looksSafeFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return false;
  // Filenames generated by us are like: `${stamp} - ${baseTitle}.pdf`
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

