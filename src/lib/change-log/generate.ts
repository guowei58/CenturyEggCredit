import { randomUUID } from "node:crypto";
import type { AiProvider } from "@/lib/ai-provider";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import {
  CHANGE_LOG_CATEGORIES,
  type ChangeLogCategory,
  type ChangeLogEntry,
  type ChangeLogEntryKind,
  type ChangeLogSourceCandidate,
} from "./types";
import { changeLogDedupeKey } from "./dedupe";
import {
  isCalendarDateKeyInChangeLogPeriod,
  type ChangeLogPeriodBounds,
} from "./period";

const SYSTEM = `You are a senior credit and special-situations analyst writing concise Key Updates for an investment under review.

You receive source candidates (SEC filings, news, industry items). Your job is to SUMMARIZE material developments — not list titles or filing types.

Rules:
- Exclude routine, immaterial, or duplicate items.
- Each entry must cite an exact sourceUrl from the candidates (do not invent URLs).
- body: ONE bullet point — 1–2 sentences summarizing what happened and why it matters for thesis, valuation, liquidity, cash flow, or credit quality. Do NOT merely restate the source headline or say "Company filed 8-K". Extract the substance.
- headline: optional short phrase (≤8 words); the UI shows body as the bullet text.
- investmentRelevance: omit if already clear in body; otherwise one short clause.
- kind: "fact" for confirmed disclosures; "analysis" only for inferred implications (label in body).
- Categories: company, filings, earnings, competitors, products, financing, management, industry, regulatory, other.
- Competitor sources (candidates with competitorTicker set) must use category "competitors". Summarize what happened at the competitor and explain why it matters for the subject investment (demand, pricing, share, margins, industry cycle, credit read-through).
- Use the candidate's date when known.
- Do not include items whose dedupeKey appears in the excluded list.
- HARD DATE RULE: every entry must fall within the update period (inclusive).
- Return valid JSON only — no markdown fences.

Output schema:
{
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "headline": "...",
      "body": "...",
      "investmentRelevance": "...",
      "kind": "fact" | "analysis",
      "category": "company" | "filings" | ... ,
      "sourceName": "...",
      "sourceUrl": "...",
      "dedupeKey": "...",
      "accessionNumber": "optional"
    }
  ]
}`;

type LlmEntry = {
  date?: string;
  headline?: string;
  body?: string;
  investmentRelevance?: string;
  kind?: string;
  category?: string;
  sourceName?: string;
  sourceUrl?: string;
  dedupeKey?: string;
  accessionNumber?: string;
};

function resolveDefaultProvider(bundle: LlmCallApiKeys): AiProvider | null {
  const order: AiProvider[] = ["openai", "claude", "gemini", "deepseek"];
  for (const p of order) {
    if (isProviderConfigured(p, bundle)) return p;
  }
  return null;
}

function normalizeCategory(raw: string | undefined): ChangeLogCategory {
  const c = (raw ?? "other").trim().toLowerCase();
  return (CHANGE_LOG_CATEGORIES as readonly string[]).includes(c) ? (c as ChangeLogCategory) : "other";
}

function normalizeKind(raw: string | undefined): ChangeLogEntryKind {
  return raw === "analysis" ? "analysis" : "fact";
}

function candidatesByUrl(candidates: ChangeLogSourceCandidate[]): Map<string, ChangeLogSourceCandidate> {
  const map = new Map<string, ChangeLogSourceCandidate>();
  for (const c of candidates) {
    map.set(c.url, c);
    map.set(c.dedupeKey, c);
  }
  return map;
}

function filterEntriesByPeriod(entries: ChangeLogEntry[], bounds: ChangeLogPeriodBounds): ChangeLogEntry[] {
  return entries.filter((e) => isCalendarDateKeyInChangeLogPeriod(e.date, bounds));
}

function fallbackEntriesFromCandidates(
  candidates: ChangeLogSourceCandidate[],
  bounds: ChangeLogPeriodBounds,
  subjectTicker: string
): ChangeLogEntry[] {
  return filterEntriesByPeriod(
    candidates.slice(0, 25).map((c) => {
      const summary = (c.summary ?? c.title).trim();
      const body =
        c.competitorTicker != null
          ? `${c.competitorTicker}: ${summary} Assess read-through for ${subjectTicker} thesis, share, and credit.`
          : c.sourceType === "sec"
            ? `${summary} Review the filing for covenant, liquidity, and thesis implications.`
            : summary.length > 40
              ? summary.slice(0, 400)
              : `${summary} — verify materiality against your thesis.`;
      return {
        id: randomUUID(),
        date: c.date,
        headline: c.title.slice(0, 80),
        body,
        kind: c.sourceType === "sec" ? ("fact" as const) : ("analysis" as const),
        category:
          c.competitorTicker != null
            ? ("competitors" as const)
            : c.sourceType === "sec"
              ? ("filings" as const)
              : c.sourceType === "industry"
                ? ("industry" as const)
                : ("company" as const),
        sourceName: c.sourceName,
        sourceUrl: c.url,
        accessionNumber: c.accessionNumber,
        dedupeKey: c.dedupeKey,
      };
    }),
    bounds
  );
}

function parseLlmJson(text: string): LlmEntry[] {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const blob = jsonMatch ? jsonMatch[0] : trimmed;
  const parsed = JSON.parse(blob) as { entries?: LlmEntry[] };
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

function parseLlmRows(
  rawEntries: LlmEntry[],
  candidates: ChangeLogSourceCandidate[],
  bounds: ChangeLogPeriodBounds,
  excludeDedupeKeys: Set<string>
): ChangeLogEntry[] {
  const byKey = candidatesByUrl(candidates);
  const entries: ChangeLogEntry[] = [];

  for (const row of rawEntries) {
    const url = typeof row.sourceUrl === "string" ? row.sourceUrl.trim() : "";
    const dedupeKey =
      typeof row.dedupeKey === "string" && row.dedupeKey.trim()
        ? row.dedupeKey.trim()
        : url
          ? changeLogDedupeKey(url, row.accessionNumber)
          : "";
    if (!dedupeKey || excludeDedupeKeys.has(dedupeKey)) continue;

    const matched = byKey.get(url) ?? byKey.get(dedupeKey);
    let body = typeof row.body === "string" ? row.body.trim() : "";
    const headline = typeof row.headline === "string" ? row.headline.trim() : "";
    const relevance =
      typeof row.investmentRelevance === "string" ? row.investmentRelevance.trim() : "";
    if (!body && headline) body = headline;
    if (!body) continue;
    if (relevance && !body.toLowerCase().includes(relevance.slice(0, 20).toLowerCase())) {
      body = `${body} ${relevance}`;
    }

    const entryDate =
      typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        ? row.date
        : matched?.date;
    if (!entryDate || !isCalendarDateKeyInChangeLogPeriod(entryDate, bounds)) continue;

    entries.push({
      id: randomUUID(),
      date: entryDate,
      headline: headline || body.slice(0, 80),
      body,
      investmentRelevance: relevance || undefined,
      kind: normalizeKind(row.kind),
      category: normalizeCategory(row.category),
      sourceName: typeof row.sourceName === "string" ? row.sourceName.trim() : matched?.sourceName ?? "Source",
      sourceUrl: url || matched?.url || "",
      accessionNumber:
        typeof row.accessionNumber === "string" ? row.accessionNumber.trim() : matched?.accessionNumber,
      dedupeKey,
    });
  }

  entries.sort((a, b) => b.date.localeCompare(a.date) || a.body.localeCompare(b.body));
  return entries;
}

export async function synthesizeChangeLogEntries(params: {
  ticker: string;
  companyName: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  candidates: ChangeLogSourceCandidate[];
  excludeDedupeKeys: Set<string>;
  provider?: AiProvider | null;
  apiKeys: LlmCallApiKeys;
  temperature: number;
}): Promise<{ entries: ChangeLogEntry[]; usedLlm: boolean; llmError?: string }> {
  const bounds: ChangeLogPeriodBounds = {
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
  };
  const filtered = params.candidates.filter((c) => !params.excludeDedupeKeys.has(c.dedupeKey));

  if (filtered.length === 0) {
    return { entries: [], usedLlm: false };
  }

  const provider = params.provider ?? resolveDefaultProvider(params.apiKeys);
  if (!provider) {
    return {
      entries: fallbackEntriesFromCandidates(filtered, bounds, params.ticker),
      usedLlm: false,
      llmError: "No LLM provider configured",
    };
  }

  const candidateLines = filtered
    .slice(0, 80)
    .map(
      (c, i) =>
        `[${i + 1}] dedupeKey=${c.dedupeKey} date=${c.date} type=${c.sourceType}${c.competitorTicker ? ` competitor=${c.competitorTicker}` : ""} source=${c.sourceName} url=${c.url}${c.accessionNumber ? ` accession=${c.accessionNumber}` : ""}${c.form ? ` form=${c.form}` : ""}\n    title: ${c.title}\n    summary: ${c.summary ?? "—"}`
    )
    .join("\n\n");

  const competitorTickers = [...new Set(filtered.map((c) => c.competitorTicker).filter(Boolean))];
  const competitorNote =
    competitorTickers.length > 0
      ? `\nCompetitor tickers in scope: ${competitorTickers.join(", ")}. Items from these companies should use category "competitors" and explain read-through to ${params.companyName} (${params.ticker}).\n`
      : "";

  const excluded = [...params.excludeDedupeKeys].slice(0, 200).join(", ") || "(none)";

  const user = `Ticker: ${params.ticker}
Company: ${params.companyName}
Update period: ${params.periodLabel}
periodStart (inclusive): ${params.periodStart.toISOString()}
periodEnd (inclusive): ${params.periodEnd.toISOString()}
${competitorNote}
Excluded dedupeKeys (already in prior updates — do not repeat):
${excluded}

Source candidates (subject company SEC filings, news, industry items, and competitor SEC/news — all within the update window):
${candidateLines}

Summarize each material item into bullet entries. Do not output raw filing titles without summarizing the substance. For competitor items, explain relevance to the subject investment.`;

  const result = await llmCompleteSingle(provider, SYSTEM, user, {
    maxTokens: Math.min(LLM_MAX_OUTPUT_TOKENS, 8192),
    apiKeys: params.apiKeys,
    temperature: params.temperature,
  });

  if (!result.ok) {
    return {
      entries: fallbackEntriesFromCandidates(filtered, bounds, params.ticker),
      usedLlm: false,
      llmError: result.error,
    };
  }

  try {
    const rawEntries = parseLlmJson(result.text);
    const entries = filterEntriesByPeriod(
      parseLlmRows(rawEntries, filtered, bounds, params.excludeDedupeKeys),
      bounds
    );

    if (entries.length === 0) {
      return {
        entries: fallbackEntriesFromCandidates(filtered, bounds, params.ticker),
        usedLlm: true,
      };
    }

    return { entries, usedLlm: true };
  } catch (e) {
    return {
      entries: fallbackEntriesFromCandidates(filtered, bounds, params.ticker),
      usedLlm: false,
      llmError: e instanceof Error ? e.message : "Failed to parse LLM output",
    };
  }
}
