import * as cheerio from "cheerio";

export const FFIEC_CDR_BULK_URL = "https://cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx";
export const FFIEC_CDR_UBPR_URL = "https://cdr.ffiec.gov/public/Reports/UbprReport.aspx";
const FDIC_INSTITUTIONS_URL = "https://api.fdic.gov/banks/institutions";
const BASE_HEADERS = { "user-agent": "Mozilla/5.0", accept: "text/html,application/xhtml+xml" };
const FORM_HEADERS = { ...BASE_HEADERS, "content-type": "application/x-www-form-urlencoded" };
const BULK_CACHE_MS = 30 * 60 * 1000;

export type FfiecBulkProductId =
  | "ReportingSeriesSinglePeriod"
  | "ReportingSeriesSubsetSchedulesFourPeriods";

export type FfiecBulkFormat = "tsv" | "xbrl";

export type FfiecBulkOption = {
  value: string;
  label: string;
};

export type FfiecInstitutionMatch = {
  name: string;
  city?: string;
  state?: string;
  address?: string;
  cert?: string;
  rssd?: string;
  bankClass?: string;
  callForm?: string;
  active?: boolean;
  raw: unknown;
};

type SelectedProductState = {
  cookie: string;
  hidden: Record<string, string>;
  periods: FfiecBulkOption[];
  callUpdated?: string;
  ubprUpdated?: string;
};

type CachedBulkCatalog = {
  expiresAt: number;
  singlePeriodOptions: FfiecBulkOption[];
  fourPeriodOptions: FfiecBulkOption[];
  callUpdated?: string;
  ubprUpdated?: string;
};

type FdicInstitutionRow = {
  data?: Record<string, unknown>;
};

let bulkCatalogCache: CachedBulkCatalog | null = null;

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractCookieHeader(res: Response): string {
  const cookieGetter = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = cookieGetter ? cookieGetter.call(res.headers) : [res.headers.get("set-cookie") ?? ""];
  return cookies
    .filter(Boolean)
    .map((value) => value.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function parseHiddenFields($: cheerio.CheerioAPI): Record<string, string> {
  return {
    AjaxScriptManager_HiddenField: String($("#AjaxScriptManager_HiddenField").val() ?? ""),
    __VIEWSTATE: String($("#__VIEWSTATE").val() ?? ""),
    __VIEWSTATEGENERATOR: String($("#__VIEWSTATEGENERATOR").val() ?? ""),
  };
}

function parseOptions($: cheerio.CheerioAPI): FfiecBulkOption[] {
  const options: FfiecBulkOption[] = [];
  $("#DatesDropDownList option").each((_idx, el) => {
    const value = normalizeWhitespace($(el).attr("value"));
    const label = normalizeWhitespace($(el).text());
    if (value && label) options.push({ value, label });
  });
  return options;
}

async function selectBulkProduct(productId: FfiecBulkProductId): Promise<SelectedProductState> {
  const initialRes = await fetch(FFIEC_CDR_BULK_URL, { headers: BASE_HEADERS, cache: "no-store" });
  const initialHtml = await initialRes.text();
  if (!initialRes.ok) {
    throw new Error(`FFIEC bulk page request failed (HTTP ${initialRes.status}).`);
  }

  const cookie = extractCookieHeader(initialRes);
  const $initial = cheerio.load(initialHtml);
  const postBody = new URLSearchParams({
    __EVENTTARGET: "ctl00$MainContentHolder$ListBox1",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    ...parseHiddenFields($initial),
    "ctl00$MainContentHolder$ListBox1": productId,
  });

  const selectedRes = await fetch(FFIEC_CDR_BULK_URL, {
    method: "POST",
    headers: { ...FORM_HEADERS, cookie },
    body: postBody,
    cache: "no-store",
  });
  const selectedHtml = await selectedRes.text();
  if (!selectedRes.ok) {
    throw new Error(`FFIEC bulk product selection failed (HTTP ${selectedRes.status}).`);
  }

  const $selected = cheerio.load(selectedHtml);
  return {
    cookie,
    hidden: parseHiddenFields($selected),
    periods: parseOptions($selected),
    callUpdated: normalizeWhitespace($selected("#UpdatedTextCDR").text()) || undefined,
    ubprUpdated: normalizeWhitespace($selected("#UpdatedTextUBPR").text()) || undefined,
  };
}

export async function getFfiecBulkCatalog() {
  if (bulkCatalogCache && bulkCatalogCache.expiresAt > Date.now()) {
    return {
      singlePeriodOptions: bulkCatalogCache.singlePeriodOptions,
      fourPeriodOptions: bulkCatalogCache.fourPeriodOptions,
      callUpdated: bulkCatalogCache.callUpdated,
      ubprUpdated: bulkCatalogCache.ubprUpdated,
    };
  }

  const [singlePeriod, fourPeriods] = await Promise.all([
    selectBulkProduct("ReportingSeriesSinglePeriod"),
    selectBulkProduct("ReportingSeriesSubsetSchedulesFourPeriods"),
  ]);

  bulkCatalogCache = {
    expiresAt: Date.now() + BULK_CACHE_MS,
    singlePeriodOptions: singlePeriod.periods,
    fourPeriodOptions: fourPeriods.periods,
    callUpdated: singlePeriod.callUpdated,
    ubprUpdated: singlePeriod.ubprUpdated,
  };

  return {
    singlePeriodOptions: singlePeriod.periods,
    fourPeriodOptions: fourPeriods.periods,
    callUpdated: singlePeriod.callUpdated,
    ubprUpdated: singlePeriod.ubprUpdated,
  };
}

function formatRadioValue(format: FfiecBulkFormat): "TSVRadioButton" | "XBRLRadiobutton" {
  return format === "xbrl" ? "XBRLRadiobutton" : "TSVRadioButton";
}

export async function downloadFfiecBulkFile(args: {
  productId: FfiecBulkProductId;
  periodValue: string;
  format: FfiecBulkFormat;
}) {
  const state = await selectBulkProduct(args.productId);
  const postBody = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    ...state.hidden,
    "ctl00$MainContentHolder$ListBox1": args.productId,
    "ctl00$MainContentHolder$DatesDropDownList": args.periodValue,
    "ctl00$MainContentHolder$FormatType": formatRadioValue(args.format),
    "ctl00$MainContentHolder$TabStrip1$Download_0": "Download",
  });

  const downloadRes = await fetch(FFIEC_CDR_BULK_URL, {
    method: "POST",
    headers: { ...FORM_HEADERS, cookie: state.cookie },
    body: postBody,
    cache: "no-store",
  });

  if (!downloadRes.ok) {
    throw new Error(`FFIEC bulk download failed (HTTP ${downloadRes.status}).`);
  }

  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const contentType = downloadRes.headers.get("content-type") || "application/octet-stream";
  const contentDisposition = downloadRes.headers.get("content-disposition") || `attachment; filename="${rid("ffiec")}.zip"`;
  const filenameMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
  const filename = filenameMatch?.[1] || `ffiec-cdr-${args.periodValue}.zip`;

  return { buffer, contentType, contentDisposition, filename };
}

function tokenizeQuery(q: string): string[] {
  return q
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function quoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildNameVariants(q: string): string[] {
  const upper = q.trim().toUpperCase();
  const normalized = upper.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const noSuffix = normalized
    .replace(/\b(NATIONAL ASSOCIATION|N A|NA|BANK|CORP(?:ORATION)?|CO(?:MPANY)?|INC(?:ORPORATED)?|LLC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [upper, normalized, noSuffix];

  if (/\bBANK\b/.test(normalized) && !/\b(NATIONAL ASSOCIATION|N A|NA)\b/.test(normalized)) {
    variants.push(`${normalized}, NATIONAL ASSOCIATION`);
    variants.push(`${normalized} NATIONAL ASSOCIATION`);
    variants.push(`${normalized}, NA`);
    variants.push(`${normalized} NA`);
  }

  return [...new Set(variants.filter((value) => value.length >= 4))];
}

function buildFdicFilters(q: string, state?: string): string {
  const phraseParts = buildNameVariants(q).map((variant) => `NAME:${quoted(variant)}`);
  const tokenPrefixes = tokenizeQuery(q)
    .slice(0, 3)
    .map((token) => `NAME:${token}*`);
  const nameClause = phraseParts.length > 0 ? `(${phraseParts.join(" OR ")})` : tokenPrefixes.join(" AND ");
  const parts = [nameClause];
  if (state?.trim()) parts.push(`STALP:${state.trim().toUpperCase()}`);
  return parts.join(" AND ");
}

export async function searchFfiecInstitutions(query: string, state?: string): Promise<FfiecInstitutionMatch[]> {
  const url = new URL(FDIC_INSTITUTIONS_URL);
  url.searchParams.set("filters", buildFdicFilters(query, state));
  url.searchParams.set("limit", "5");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), { cache: "no-store", headers: { accept: "application/json" } });
  const raw = (await res.json().catch(() => null)) as { data?: FdicInstitutionRow[] } | null;
  if (!res.ok) {
    throw new Error(`FDIC institution lookup failed (HTTP ${res.status}).`);
  }

  const rows = raw?.data ?? [];
  const deduped = new Map<string, FfiecInstitutionMatch>();
  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const rssd = normalizeWhitespace(data.FED_RSSD ?? data.RSSDHCR);
    const name = normalizeWhitespace(data.NAME);
    if (!rssd || !name) continue;
    if (deduped.has(rssd)) continue;

    deduped.set(rssd, {
      name,
      city: normalizeWhitespace(data.CITY) || undefined,
      state: normalizeWhitespace(data.STALP) || undefined,
      address: normalizeWhitespace(data.ADDRESS) || undefined,
      cert: normalizeWhitespace(data.CERT ?? data.NEWCERT) || undefined,
      rssd,
      bankClass: normalizeWhitespace(data.BKCLASS) || undefined,
      callForm: normalizeWhitespace(data.CALLFORM) || undefined,
      active: Number(data.ACTIVE ?? 0) === 0 ? true : Number(data.ACTIVE ?? 0) === 1 ? false : undefined,
      raw: row,
    });
  }

  return [...deduped.values()];
}

export function buildFfiecUbprReportUrl(rssd: string, cycleIds: string[]): string {
  const url = new URL(FFIEC_CDR_UBPR_URL);
  url.searchParams.set("idrssd", rssd);
  url.searchParams.set("rptid", "283");
  if (cycleIds.length > 0) url.searchParams.set("rptCycleIds", cycleIds.join(","));
  return url.toString();
}

export function buildFfiecBulkDownloadUrl(args: {
  productId: FfiecBulkProductId;
  periodValue: string;
  format: FfiecBulkFormat;
}) {
  const url = new URL("/api/ffiec-cdr/download", "http://local");
  url.searchParams.set("product", args.productId);
  url.searchParams.set("period", args.periodValue);
  url.searchParams.set("format", args.format);
  return `${url.pathname}${url.search}`;
}
