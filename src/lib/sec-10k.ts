"use server";

import { getFilingsByTicker, getAllFilingsByTicker, type SecFiling, type SecFilingsResult } from "@/lib/sec-edgar";

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

export type TenKSource = {
  filingDate: string;
  form: string;
  accessionNumber: string;
  docUrl: string;
};

export type BusinessLine = {
  name: string;
  description: string;
  whyItMatters: string;
  characteristics?: string[];
  confidence: "high" | "medium" | "low";
};

export type TenKBusinessProfile = {
  ticker: string;
  companyName: string;
  source: TenKSource;
  businessDescription: {
    text: string;
    confidence: "high" | "medium" | "low";
    note?: string;
  };
  businessLines: BusinessLine[];
};

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html: string): string {
  // Minimal, robust-enough for SEC filings: remove scripts/styles, then tags.
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(text));
}

/**
 * Annual report forms in the 10-K family (SEC EDGAR).
 * Excludes "NT 10-K" (late filing notices) — those are not substantive annual reports.
 */
function isAnnualTenKForm(formRaw: string): boolean {
  const raw = (formRaw ?? "").trim().replace(/\u00a0/g, " ");
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (/\bNT\s*10-K\b/i.test(compact)) return false;
  const u = compact.toUpperCase();
  if (u === "10-K" || u === "10-K/A") return true;
  if (u === "10-KT" || u === "10-KT/A") return true;
  if (/^10-K\d/i.test(u.replace(/\s/g, ""))) return true;
  return false;
}

function pickLatest10K(filings: SecFiling[]): SecFiling | null {
  const candidates = filings
    .filter((f) => typeof f.form === "string" && isAnnualTenKForm(f.form))
    .sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
  if (candidates.length === 0) return null;

  // Prefer plain 10-K over 10-K/A if same date range.
  const plain = candidates.find((c) => c.form.trim().toUpperCase().replace(/\s+/g, "") === "10-K");
  return plain ?? candidates[0];
}

async function findLatestTenKFilingForTicker(ticker: string): Promise<{ filing: SecFiling; companyName: string } | null> {
  const sym = ticker.trim().toUpperCase();
  const nameFrom = (p: SecFilingsResult | null) => (p?.companyName?.trim() ? p.companyName.trim() : sym);

  const recent = await getFilingsByTicker(sym);
  if (!recent) return null;

  let companyName = nameFrom(recent);
  let filing = pickLatest10K(recent.filings);
  if (filing) return { filing, companyName };

  const full = await getAllFilingsByTicker(sym);
  if (!full) return null;
  companyName = nameFrom(full);
  filing = pickLatest10K(full.filings);
  if (!filing) return null;
  return { filing, companyName };
}

/** Latest 10-K-class filing, searching full submission history if needed (recent feed is capped). */
export async function resolveLatest10KFiling(ticker: string): Promise<SecFiling | null> {
  const hit = await findLatestTenKFilingForTicker(ticker);
  return hit?.filing ?? null;
}

function findItemSection(text: string): { item1: string | null; confidence: "high" | "medium" | "low"; note?: string } {
  const t = text;
  const idxItem1 = t.search(/\bITEM\s+1\b[\s\S]{0,10}\bBUSINESS\b|\bITEM\s+1\b/i);
  if (idxItem1 < 0) {
    return {
      item1: null,
      confidence: "low",
      note: "Could not locate Item 1 (Business) markers in the filing text.",
    };
  }

  // End at Item 1A or Item 2, whichever comes first after Item 1.
  const after = t.slice(idxItem1);
  const rel1A = after.search(/\bITEM\s+1A\b/i);
  const rel2 = after.search(/\bITEM\s+2\b/i);

  let endRel = -1;
  if (rel1A >= 0 && rel2 >= 0) endRel = Math.min(rel1A, rel2);
  else endRel = rel1A >= 0 ? rel1A : rel2;

  const item1 = endRel > 0 ? after.slice(0, endRel) : after;
  const cleaned = normalizeWhitespace(item1);
  const confidence: "high" | "medium" | "low" = rel1A >= 0 || rel2 >= 0 ? "high" : "medium";
  return { item1: cleaned, confidence };
}

function summarizeBusinessDescription(item1: string): string {
  // Take the first ~2-3 paragraphs, capped for concision.
  const paras = item1.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const picked: string[] = [];
  let chars = 0;
  for (const p of paras) {
    if (picked.length >= 3) break;
    if (p.length < 40) continue;
    picked.push(p);
    chars += p.length;
    if (chars >= 900) break;
  }
  const out = picked.join("\n\n").trim();
  return out.length > 1200 ? `${out.slice(0, 1200).trim()}…` : out;
}

function splitNamesList(s: string): string[] {
  return s
    .replace(/;\s*/g, ", ")
    .split(/,|\band\b|\&/i)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length > 1 && x.length < 80);
}

function inferBusinessLines(item1: string): BusinessLine[] {
  const lines: BusinessLine[] = [];

  // 1) Explicit segment list patterns.
  const patterns: RegExp[] = [
    /reportable segments are\s*([^.\n]+)\./i,
    /our segments are\s*([^.\n]+)\./i,
    /we operate (?:in|through)\s*(?:the following\s*)?segments?:\s*([^.\n]+)\./i,
  ];

  let extractedNames: string[] = [];
  for (const re of patterns) {
    const m = item1.match(re);
    if (m?.[1]) {
      extractedNames = splitNamesList(m[1]);
      if (extractedNames.length) break;
    }
  }

  if (extractedNames.length) {
    for (const name of extractedNames) {
      const idx = item1.toLowerCase().indexOf(name.toLowerCase());
      const window = idx >= 0 ? item1.slice(Math.max(0, idx - 250), Math.min(item1.length, idx + 450)) : "";
      const desc = window
        ? normalizeWhitespace(window).split(/\n\s*\n/)[0].slice(0, 360).trim()
        : "";

      lines.push({
        name,
        description: desc || "Disclosed as a reportable business segment in Item 1 (Business).",
        whyItMatters:
          "The company identifies this as a primary operating/management reporting segment, implying strategic and financial importance.",
        confidence: desc ? "high" : "medium",
      });
    }
    return lines;
  }

  // 2) Fallback: do NOT invent segments. Provide a single inferred line with explicit low confidence.
  const summary = summarizeBusinessDescription(item1);
  return [
    {
      name: "Core business",
      description: summary || "See Item 1 (Business) in the source filing.",
      whyItMatters:
        "The filing does not clearly enumerate reportable segments in the extracted text; this is a high-level description inferred from Item 1 language.",
      confidence: "low",
    },
  ];
}

/** Raw 10-K data for Overview tab: Item 1 text + segment names/revenue for ChatGPT and reconciliation. */
export type TenKOverviewRaw = {
  companyName: string;
  source: TenKSource;
  item1Text: string;
  segmentNames: string[];
  segmentRevenues: { segmentName: string; revenue: number }[];
  totalRevenue: number | null;
  segmentRevenueUnclear: boolean;
};

const MAX_ITEM1_FOR_LLM = 28000;

/** Best-effort: find segment revenue numbers in full filing text. Looks for segment note and dollar amounts. */
function extractSegmentRevenuesFromText(
  fullText: string,
  segmentNames: string[]
): { segmentRevenues: { segmentName: string; revenue: number }[]; totalRevenue: number | null } {
  const segmentRevenues: { segmentName: string; revenue: number }[] = [];
  // Dollar amounts: $1,234,567 or 1,234,567 (in millions often)
  const dollarRe = /\$?\s*([\d,]+(?:\.[\d]+)?)\s*(?:million|M|billion|B)?/gi;
  const segmentNoteStart = fullText.search(/\bsegment\s+information\b|\bnote\s+\d+[.\s]*\bsegment\b|\brevenue\s+by\s+segment\b/i);
  const searchWindow = segmentNoteStart >= 0 ? fullText.slice(segmentNoteStart, segmentNoteStart + 15000) : fullText;
  for (const name of segmentNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRe = new RegExp(escaped + "[\\s\\S]{0,80}?\\$?\\s*([\\d,]+(?:\\.[\\d]+)?)\\s*(?:million|M|billion|B)?", "i");
    const m = searchWindow.match(nameRe);
    if (m?.[1]) {
      const numStr = m[1].replace(/,/g, "");
      const num = parseFloat(numStr);
      if (Number.isFinite(num) && num > 0) {
        const scale = /million|M\b/i.test((m[0] || "")) ? 1 : /billion|B\b/i.test((m[0] || "")) ? 1000 : 1;
        segmentRevenues.push({ segmentName: name, revenue: num * scale });
      }
    }
  }
  const totalMatch = searchWindow.match(/\btotal\b[\s\S]{0,60}?\$?\s*([\d,]+(?:\.[\d]+)?)\s*(?:million|M|billion|B)?/i);
  let totalRevenue: number | null = null;
  if (totalMatch?.[1]) {
    const n = parseFloat(totalMatch[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) {
      const scale = /million|M\b/i.test(totalMatch[0] || "") ? 1 : /billion|B\b/i.test(totalMatch[0] || "") ? 1000 : 1;
      totalRevenue = n * scale;
    }
  }
  if (segmentRevenues.length > 0 && !totalRevenue) {
    const sum = segmentRevenues.reduce((a, b) => a + b.revenue, 0);
    totalRevenue = sum;
  }
  return { segmentRevenues, totalRevenue };
}

export async function get10KOverviewRaw(ticker: string): Promise<TenKOverviewRaw | null> {
  const safeTicker = ticker.trim().toUpperCase();
  const hit = await findLatestTenKFilingForTicker(safeTicker);
  if (!hit) return null;

  const { filing: tenk, companyName } = hit;

  const docRes = await fetch(tenk.docUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!docRes.ok) return null;
  const html = await docRes.text();
  const text = stripHtml(html);

  const { item1 } = findItemSection(text);
  const item1Text = (item1 ?? text.slice(0, 12000)).slice(0, MAX_ITEM1_FOR_LLM);
  const lines = inferBusinessLines(item1 ?? text.slice(0, 8000));
  const segmentNames = lines.map((l) => l.name);
  const { segmentRevenues, totalRevenue } = extractSegmentRevenuesFromText(text, segmentNames);
  const segmentRevenueUnclear = segmentRevenues.length === 0 && segmentNames.length > 1;

  return {
    companyName: companyName || safeTicker,
    source: {
      filingDate: tenk.filingDate,
      form: tenk.form,
      accessionNumber: tenk.accessionNumber,
      docUrl: tenk.docUrl,
    },
    item1Text,
    segmentNames,
    segmentRevenues,
    totalRevenue,
    segmentRevenueUnclear,
  };
}

export async function getLatest10KBusinessProfile(ticker: string): Promise<TenKBusinessProfile | null> {
  const safeTicker = ticker.trim().toUpperCase();
  const hit = await findLatestTenKFilingForTicker(safeTicker);
  if (!hit) return null;

  const { filing: tenk, companyName } = hit;

  const docRes = await fetch(tenk.docUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!docRes.ok) return null;
  const html = await docRes.text();
  const text = stripHtml(html);

  const { item1, confidence, note } = findItemSection(text);
  const item1Text = item1 ?? text.slice(0, 8000);
  const businessText = summarizeBusinessDescription(item1Text);
  const lines = inferBusinessLines(item1Text);

  return {
    ticker: safeTicker,
    companyName: companyName || safeTicker,
    source: {
      filingDate: tenk.filingDate,
      form: tenk.form,
      accessionNumber: tenk.accessionNumber,
      docUrl: tenk.docUrl,
    },
    businessDescription: {
      text: businessText || "—",
      confidence,
      note,
    },
    businessLines: lines,
  };
}

/** Latest 10-K primary document URL + filing meta for linking (SEC EDGAR). */
export async function getLatest10KFilingMeta(ticker: string): Promise<TenKSource | null> {
  const tenk = await resolveLatest10KFiling(ticker.trim().toUpperCase());
  if (!tenk) return null;
  return {
    filingDate: tenk.filingDate,
    form: tenk.form,
    accessionNumber: tenk.accessionNumber,
    docUrl: tenk.docUrl,
  };
}

