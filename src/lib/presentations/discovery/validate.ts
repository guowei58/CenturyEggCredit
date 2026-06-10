import { createHash } from "crypto";
import type {
  PresentationDiscoveryInput,
  PresentationValidationResult,
  RawPresentationLink,
  ValidatedPresentationCandidate,
} from "./types";
import { inferPeriodFromText, parseFiscalPeriodToken, periodsMatch } from "./period";
import { computeFinalConfidence, reviewStatusForConfidence } from "./score";

const PRESENTATION_KEYWORDS = [
  "investor presentation",
  "earnings presentation",
  "quarterly results presentation",
  "financial results presentation",
  "management presentation",
  "slide deck",
  "investor deck",
];

const PRESS_RELEASE_KEYWORDS = ["press release", "news release", "earnings release"];

const TRANSCRIPT_SIGNAL_RE =
  /\bearnings\s+call\b|\bconference\s+call\s+transcript\b|\bcall\s+transcript\b|\btranscript\b|\boperator:\b|\bquestion-and-answer\b|\bq\s*&\s*a\s+session\b/i;

export function isTranscriptLikeDocument(text: string, title: string, url = ""): boolean {
  const hay = `${title} ${url} ${text}`;
  return TRANSCRIPT_SIGNAL_RE.test(hay);
}

const CORP_SUFFIXES = new Set(["inc", "corp", "corporation", "company", "co", "ltd", "plc", "the", "llc", "lp"]);

/** Tokens that produce substring false positives in unrelated filings (e.g. Gen Digital → "gen", "digital"). */
const AMBIGUOUS_COMPANY_TOKENS = new Set([
  "gen",
  "digital",
  "global",
  "national",
  "american",
  "united",
  "first",
  "general",
  "group",
  "holdings",
  "services",
  "systems",
  "technologies",
  "technology",
  "solutions",
  "international",
  "partners",
  "capital",
  "financial",
  "health",
  "media",
  "data",
  "cloud",
  "software",
  "network",
  "security",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCompanyTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !CORP_SUFFIXES.has(t));
}

function tokenHasWordBoundaryMatch(token: string, hay: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
  return re.test(hay);
}

export function tickerMatchesDocument(ticker: string, title: string, url: string, text: string): boolean {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!sym || sym.length < 1) return false;
  const hay = `${title} ${url} ${text}`;
  const re = new RegExp(`\\b${escapeRegExp(sym)}\\b`, "i");
  return re.test(hay);
}

function looksLikeFiscalToken(token: string): boolean {
  return /^Q[1-4]$/.test(token) || /^FY\d{2,4}$/.test(token) || /^\d{4}$/.test(token);
}

/** Title cites a different issuer ticker (e.g. SMWB deck when searching GEN). */
export function prominentForeignTickerInTitle(title: string, expectedTicker: string): string | null {
  const expected = expectedTicker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!expected) return null;
  const upper = title.toUpperCase();
  const patterns = [
    /\]\s*([A-Z][A-Z0-9.-]{1,5})\s+Q[1-4]/,
    /\b([A-Z][A-Z0-9.-]{1,5})\s+Q[1-4]\s+\d{4}/,
    /\b([A-Z][A-Z]{2,5})\s+(?:INVESTOR\s+)?PRESENTATION\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(upper);
    const found = m?.[1]?.replace(/[^A-Z0-9.-]/g, "");
    if (!found || found === expected || looksLikeFiscalToken(found)) continue;
    return found;
  }
  return null;
}

export function companyNameMatchesText(
  companyName: string,
  text: string,
  opts?: { ticker?: string; title?: string; url?: string }
): boolean {
  const hay = `${opts?.title ?? ""} ${opts?.url ?? ""} ${text}`.trim();
  if (!hay) return false;

  if (opts?.ticker && tickerMatchesDocument(opts.ticker, opts?.title ?? "", opts?.url ?? "", text)) {
    return true;
  }

  const normalizedName = companyName.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (normalizedName.length >= 4) {
    const phraseRe = new RegExp(`\\b${escapeRegExp(normalizedName)}\\b`, "i");
    if (phraseRe.test(hay)) return true;
  }

  const tokens = normalizeCompanyTokens(companyName);
  if (tokens.length === 0) return Boolean(opts?.ticker && tickerMatchesDocument(opts.ticker, opts?.title ?? "", opts?.url ?? "", text));

  const strongHits = tokens.filter((t) => !AMBIGUOUS_COMPANY_TOKENS.has(t) && tokenHasWordBoundaryMatch(t, hay));
  const requiredStrong = tokens.every((t) => AMBIGUOUS_COMPANY_TOKENS.has(t))
    ? 0
    : Math.min(2, tokens.filter((t) => !AMBIGUOUS_COMPANY_TOKENS.has(t)).length);

  if (requiredStrong > 0 && strongHits.length >= requiredStrong) return true;
  if (tokens.length === 1 && !AMBIGUOUS_COMPANY_TOKENS.has(tokens[0]!) && tokenHasWordBoundaryMatch(tokens[0]!, hay)) {
    return true;
  }

  return false;
}

export function classifyDocumentType(
  text: string,
  title: string,
  url = ""
): PresentationValidationResult["document_type"] {
  const hay = `${title} ${text} ${url}`.toLowerCase();
  if (isTranscriptLikeDocument(text, title, url)) return "earnings_transcript";
  if (PRESS_RELEASE_KEYWORDS.some((k) => hay.includes(k))) return "press_release";
  if (PRESENTATION_KEYWORDS.some((k) => hay.includes(k))) {
    if (/earnings presentation|earnings deck|quarterly results presentation/.test(hay)) return "earnings_deck";
    return "investor_presentation";
  }
  if (/\b(?:investor|earnings|quarterly)\s+(?:presentation|deck|slides)\b|\bslide\s+deck\b/.test(hay)) {
    return "investor_presentation";
  }
  return "unknown";
}

export function collectKeywordHits(text: string, title: string): string[] {
  const hay = `${title} ${text}`.toLowerCase();
  return PRESENTATION_KEYWORDS.filter((k) => hay.includes(k));
}

async function extractPdfSample(buffer: Buffer): Promise<{ text: string; page_count: number | null }> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const tr = await parser.getText({ first: 5 });
      const page_count = typeof tr.total === "number" ? tr.total : null;
      return { text: (tr.text ?? "").replace(/\s+/g, " ").trim().slice(0, 4000), page_count };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return { text: "", page_count: null };
  }
}

async function llmValidatePresentation(
  companyName: string,
  period: string,
  title: string,
  textSample: string
): Promise<PresentationValidationResult["llm"] | undefined> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key || textSample.length < 40) return undefined;

  const prompt = `You validate whether a downloaded file is the company's slide-deck / investor presentation (NOT an earnings call transcript, NOT a press release) for a fiscal period.
Return ONLY JSON: {"is_presentation":boolean,"period_match":boolean,"confidence_adjustment":number,"rationale":string}
confidence_adjustment is -15..+15. Use negative values for transcripts, press releases, or generic SEC filings.

Company: ${companyName}
Expected period: ${period}
Title: ${title}
Text sample: ${textSample.slice(0, 2500)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) return undefined;
    const parsed = JSON.parse(jsonMatch[0]!) as {
      is_presentation?: boolean;
      period_match?: boolean;
      confidence_adjustment?: number;
      rationale?: string;
    };
    return {
      is_presentation: Boolean(parsed.is_presentation),
      period_match: Boolean(parsed.period_match),
      confidence_adjustment:
        typeof parsed.confidence_adjustment === "number"
          ? Math.max(-15, Math.min(15, Math.round(parsed.confidence_adjustment)))
          : 0,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 400) : "",
    };
  } catch {
    return undefined;
  }
}

function downloadTimeoutMs(url: string): number {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("q4cdn.com")) return 120_000;
  } catch {
    /* default */
  }
  return 60_000;
}

export async function headPresentationFile(url: string, referer?: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "CenturyEggCredit/1.0 (presentation discovery)",
        Accept: "application/pdf,*/*",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function downloadPresentationFile(url: string, referer?: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(downloadTimeoutMs(url)),
      headers: {
        "User-Agent": "CenturyEggCredit/1.0 (presentation discovery)",
        Accept: "application/pdf,application/vnd.ms-powerpoint,*/*",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 512) return null;
    return buf;
  } catch {
    return null;
  }
}

function isTrustedQ4PresentationLink(raw: RawPresentationLink): boolean {
  return raw.source_type === "q4_ir" && raw.evidence.includes("document_category:presentation");
}

export async function validatePresentationCandidate(
  input: PresentationDiscoveryInput,
  raw: RawPresentationLink
): Promise<ValidatedPresentationCandidate> {
  const fp = parseFiscalPeriodToken(input.period);
  const contextText = `${raw.title} ${raw.url}`;
  const inferredFromMeta = inferPeriodFromText(contextText);
  const foreignTicker = prominentForeignTickerInTitle(raw.title, input.ticker);

  if (isTrustedQ4PresentationLink(raw) && !foreignTicker) {
    const reachable = await headPresentationFile(raw.url, raw.source_page_url);
    const companyOk =
      tickerMatchesDocument(input.ticker, raw.title, raw.url, "") ||
      companyNameMatchesText(input.companyName, `${raw.title} ${raw.url}`, {
        ticker: input.ticker,
        title: raw.title,
        url: raw.url,
      });
    const validation: PresentationValidationResult = {
      downloaded: reachable,
      company_name_match: companyOk,
      document_type: "investor_presentation",
      period_match: true,
      inferred_period: fp?.label ?? input.period,
      inferred_document_date: raw.document_date,
      keyword_hits: ["investor presentation"],
      reject_reason: !reachable
        ? "Presentation URL not reachable"
        : !companyOk
          ? "Company name or ticker not found for Q4 feed document"
          : undefined,
    };
    const confidence = computeFinalConfidence(raw, validation, input.period);
    const review_status = reviewStatusForConfidence(confidence);
    return {
      ticker: input.ticker,
      cik: input.cik,
      company_name: input.companyName,
      period: fp?.label ?? input.period,
      document_date: raw.document_date,
      title: raw.title,
      url: raw.url,
      source_page_url: raw.source_page_url,
      source_type: raw.source_type,
      file_type: raw.file_type,
      confidence,
      evidence: raw.evidence,
      sha256: null,
      page_count: null,
      text_sample: null,
      review_status,
      validation,
    };
  }

  let buffer: Buffer | null = null;
  let text_sample: string | null = null;
  let page_count: number | null = null;
  let sha256: string | null = null;

  if (raw.file_type === "pdf") {
    buffer = await downloadPresentationFile(raw.url, raw.source_page_url);
  }

  const validation: PresentationValidationResult = {
    downloaded: Boolean(buffer),
    company_name_match: true,
    document_type: "unknown",
    period_match: false,
    inferred_period: inferredFromMeta,
    inferred_document_date: raw.document_date,
    keyword_hits: collectKeywordHits("", raw.title),
  };

  if (buffer) {
    sha256 = createHash("sha256").update(buffer).digest("hex");
    const extracted = await extractPdfSample(buffer);
    text_sample = extracted.text || null;
    page_count = extracted.page_count;
    validation.company_name_match = companyNameMatchesText(input.companyName, text_sample || raw.title, {
      ticker: input.ticker,
      title: raw.title,
      url: raw.url,
    });
    validation.document_type = classifyDocumentType(text_sample || "", raw.title, raw.url);
    validation.keyword_hits = collectKeywordHits(text_sample || "", raw.title);
    validation.inferred_period = inferPeriodFromText(`${raw.title} ${text_sample ?? ""}`) ?? inferredFromMeta;
    validation.period_match = fp ? periodsMatch(fp, validation.inferred_period) : false;
    validation.llm = await llmValidatePresentation(input.companyName, input.period, raw.title, text_sample ?? "");
    if (validation.llm?.period_match && fp) validation.period_match = true;

    if (foreignTicker) {
      validation.company_name_match = false;
      validation.reject_reason = `Title references a different ticker (${foreignTicker})`;
    } else if (!validation.company_name_match) {
      validation.reject_reason = "Company name or ticker not found in document text";
    } else if (validation.document_type === "earnings_transcript") {
      validation.reject_reason = "Document classified as earnings call transcript, not slide deck";
    } else if (validation.document_type === "press_release") {
      validation.reject_reason = "Document classified as press release, not presentation";
    } else if (page_count != null && page_count > 250) {
      validation.reject_reason = "Unusually large page count for earnings deck";
    }
  } else if (raw.file_type !== "pdf") {
    validation.document_type = classifyDocumentType("", raw.title, raw.url);
    validation.company_name_match = companyNameMatchesText(input.companyName, raw.title, {
      ticker: input.ticker,
      title: raw.title,
      url: raw.url,
    });
    validation.period_match = fp ? periodsMatch(fp, inferredFromMeta) : false;
    if (foreignTicker) {
      validation.company_name_match = false;
      validation.reject_reason = `Title references a different ticker (${foreignTicker})`;
    } else {
      validation.reject_reason = "Non-PDF deck; text validation skipped";
    }
  } else {
    validation.reject_reason = "Could not download file";
    validation.company_name_match = false;
  }

  const confidence = computeFinalConfidence(raw, validation, input.period);
  const review_status = reviewStatusForConfidence(confidence);

  return {
    ticker: input.ticker,
    cik: input.cik,
    company_name: input.companyName,
    period: fp?.label ?? input.period,
    document_date: raw.document_date,
    title: raw.title,
    url: raw.url,
    source_page_url: raw.source_page_url,
    source_type: raw.source_type,
    file_type: raw.file_type,
    confidence,
    evidence: raw.evidence,
    sha256,
    page_count,
    text_sample,
    review_status,
    validation,
  };
}
