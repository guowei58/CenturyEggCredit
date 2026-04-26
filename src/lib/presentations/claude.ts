/**
 * Claude as reasoning layer: (1) select official website/IR from candidates,
 * (2) rank/classify PDFs. All calls server-side; only return values from provided inputs (no hallucination).
 */

import { callClaude } from "@/lib/anthropic";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { ClaudeSelectionResult } from "./types";
import type { PdfForRanking, RankedPdf } from "./types";

const SELECTION_SYSTEM = `You are a precise assistant. You must respond with valid JSON only, no markdown or explanation.
Given a company name, ticker, and a list of candidate URLs from web search, choose the most likely OFFICIAL company website and the most likely OFFICIAL investor relations page.
Rules:
- Only pick URLs that appear in the candidate list. Return null for officialWebsite or investorRelationsPage if none are confident.
- Prefer corporate domains (e.g. companyname.com) over news or aggregators.
- confidence must be one of: "high", "medium", "low".
- If you are unsure, use "low" confidence and leave notes explaining why.
Respond with exactly this JSON shape (no other keys):
{"officialWebsite": "<url or null>", "investorRelationsPage": "<url or null>", "confidence": "high"|"medium"|"low", "notes": "<string or null>", "candidateWebsites": ["<url1>", "<url2>", ...]}`;

const RANKING_SYSTEM = `You are a precise assistant. You must respond with valid JSON only.
Given a list of PDF links extracted from a company's official or IR pages, classify each by "Likely Presentation" (investor decks, earnings slides, conference presentations) or "Other PDF" (forms, reports, legal docs).
Return a JSON array of objects with exactly: "url", "classification" ("Likely Presentation" or "Other PDF"), "rank" (1-based, presentations first).
Include every URL from the input exactly once. Do not add or remove URLs.`;

function parseSelection(text: string | null, allowedUrls: Set<string>): ClaudeSelectionResult | null {
  if (!text) return null;
  try {
    const raw = text.replace(/```json?\s*|\s*```/g, "").trim();
    const j = JSON.parse(raw) as {
      officialWebsite?: string | null;
      investorRelationsPage?: string | null;
      confidence?: string;
      notes?: string | null;
      candidateWebsites?: string[];
    };
    const officialWebsite =
      typeof j.officialWebsite === "string" && j.officialWebsite && allowedUrls.has(j.officialWebsite)
        ? j.officialWebsite
        : null;
    const investorRelationsPage =
      typeof j.investorRelationsPage === "string" && j.investorRelationsPage && allowedUrls.has(j.investorRelationsPage)
        ? j.investorRelationsPage
        : null;
    const confidence =
      j.confidence === "high" || j.confidence === "medium" || j.confidence === "low" ? j.confidence : "low";
    const notes = typeof j.notes === "string" ? j.notes : null;
    const candidateWebsites = Array.isArray(j.candidateWebsites)
      ? j.candidateWebsites.filter((u): u is string => typeof u === "string" && allowedUrls.has(u))
      : [];
    return {
      officialWebsite,
      investorRelationsPage,
      confidence,
      notes,
      candidateWebsites: candidateWebsites.length > 0 ? candidateWebsites : Array.from(allowedUrls),
    };
  } catch {
    return null;
  }
}

/**
 * Select official website and IR page from candidates. Returns null if API fails or parse fails.
 */
export async function selectWebsiteAndIr(
  companyName: string,
  ticker: string,
  candidates: { url: string; title: string }[]
): Promise<ClaudeSelectionResult | null> {
  const allowedUrls = new Set(candidates.map((c) => c.url));
  const list = candidates.map((c) => `${c.url} (${c.title || "no title"})`).join("\n");
  const userMessage = `Company: ${companyName}\nTicker: ${ticker}\n\nCandidate URLs:\n${list}`;
  const claudeResult = await callClaude(SELECTION_SYSTEM, userMessage, { maxTokens: LLM_MAX_OUTPUT_TOKENS });
  const text = claudeResult.ok ? claudeResult.text : null;
  return parseSelection(text, allowedUrls);
}

function parseRanking(text: string | null, pdfs: PdfForRanking[]): RankedPdf[] | null {
  if (!text) return null;
  const urlSet = new Set(pdfs.map((p) => p.url));
  try {
    const raw = text.replace(/```json?\s*|\s*```/g, "").trim();
    const arr = JSON.parse(raw) as Array<{ url?: string; classification?: string; rank?: number }>;
    if (!Array.isArray(arr)) return null;
    const byUrl = new Map(pdfs.map((p) => [p.url, p]));
    const result: RankedPdf[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      const url = typeof item.url === "string" ? item.url : "";
      if (!url || !urlSet.has(url) || seen.has(url)) continue;
      seen.add(url);
      const base = byUrl.get(url);
      if (!base) continue;
      const classification =
        item.classification === "Likely Presentation" ? "Likely Presentation" : "Other PDF";
      const rank = typeof item.rank === "number" && item.rank >= 1 ? item.rank : result.length + 1;
      result.push({ ...base, classification, rank });
    }
    for (const p of pdfs) {
      if (!seen.has(p.url)) result.push({ ...p, classification: "Other PDF", rank: result.length + 1 });
    }
    result.sort((a, b) => a.rank - b.rank);
    return result;
  } catch {
    return null;
  }
}

/**
 * Classify and rank PDFs. Returns null on failure; then caller keeps original order and "Other PDF".
 */
export async function rankPdfs(pdfs: PdfForRanking[]): Promise<RankedPdf[] | null> {
  if (pdfs.length === 0) return [];
  const list = pdfs.map((p) => `${p.url}\n  title: ${p.title}\n  source: ${p.sourcePage}`).join("\n\n");
  const userMessage = `PDFs:\n${list}`;
  const claudeResult = await callClaude(RANKING_SYSTEM, userMessage, { maxTokens: LLM_MAX_OUTPUT_TOKENS });
  const text = claudeResult.ok ? claudeResult.text : null;
  return parseRanking(text, pdfs);
}
