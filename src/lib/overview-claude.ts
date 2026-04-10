/**
 * LLM summarization for Overview tab (Claude or OpenAI).
 * Server-side only.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { getDeepSeekModel } from "@/lib/deepseek";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { ResponseVerbosity } from "@/lib/llm-response-verbosity";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

export type OverviewLlmModels = {
  claudeModel?: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel?: string;
};

function defaultOverviewModels(): OverviewLlmModels {
  return {
    claudeModel: process.env.ANTHROPIC_MODEL?.trim() || undefined,
    openaiModel: process.env.OPENAI_OVERVIEW_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || undefined,
    geminiModel: process.env.GEMINI_OVERVIEW_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || undefined,
    deepseekModel: process.env.DEEPSEEK_OVERVIEW_MODEL?.trim() || getDeepSeekModel(),
  };
}

const BUSINESS_OVERVIEW_SYSTEM = `You are a clear, concise business writer. Your job is to summarize company business descriptions from SEC 10-K filings in plain English for a non-expert reader.
- Use simple, clear language. Avoid jargon where possible.
- Keep it concise but informative (a few short paragraphs).
- Do not invent facts. Only summarize what is in the text.
- If the text is unclear or missing, say so briefly.`;

const BUSINESS_OVERVIEW_USER_PREFIX = `Summarize the following "Item 1 - Business" section from a company's 10-K filing in plain English. Make it easy for a non-expert to understand what the company does.\n\n---\n\n`;

const SEGMENT_SUMMARY_SYSTEM = `You are a clear business writer. Summarize each business segment or business line from an SEC 10-K in one short paragraph of plain English.
- Explain what each segment actually does in simple terms.
- Do not invent segments or revenue numbers. Only describe segments that are listed.
- If a segment description is unclear from the text, say "Description not clearly disclosed" for that segment.
- Output exactly one paragraph per segment, in the same order as the segment names provided.`;

async function llmComplete(
  provider: AiProvider,
  system: string,
  userContent: string,
  maxTokens = 1500,
  models?: OverviewLlmModels,
  apiKeys?: LlmCallApiKeys,
  responseVerbosity?: ResponseVerbosity
): Promise<string> {
  const m = models ?? defaultOverviewModels();
  const result = await llmCompleteSingle(provider, system, userContent, {
    maxTokens,
    claudeModel: m.claudeModel,
    openaiModel: m.openaiModel,
    geminiModel: m.geminiModel,
    deepseekModel: m.deepseekModel,
    apiKeys,
    responseVerbosity,
  });
  if (!result.ok) throw new Error(result.error);
  return result.text.trim();
}

/**
 * Summarize raw Item 1 (Business) text in plain English for the Business Overview section.
 */
export async function summarizeBusinessOverview(
  item1Text: string,
  provider: AiProvider,
  models?: OverviewLlmModels,
  apiKeys?: LlmCallApiKeys,
  responseVerbosity?: ResponseVerbosity
): Promise<string> {
  const truncated = item1Text.length > 26000 ? item1Text.slice(0, 26000) + "\n\n[Text truncated.]" : item1Text;
  const userContent = BUSINESS_OVERVIEW_USER_PREFIX + truncated;
  return llmComplete(provider, BUSINESS_OVERVIEW_SYSTEM, userContent, 1200, models, apiKeys, responseVerbosity);
}

export type SegmentSummary = {
  segmentName: string;
  description: string;
  revenue?: number;
  pctOfTotal?: number;
};

/**
 * Summarize each business line/segment in plain English. Optionally pass segment revenues for display.
 * Does not invent revenue; only uses provided numbers.
 */
export async function summarizeBusinessLines(
  segmentNames: string[],
  item1Text: string,
  segmentRevenues: { segmentName: string; revenue: number }[] = [],
  totalRevenue: number | null = null,
  provider: AiProvider = "claude",
  models?: OverviewLlmModels,
  apiKeys?: LlmCallApiKeys,
  responseVerbosity?: ResponseVerbosity
): Promise<SegmentSummary[]> {
  if (segmentNames.length === 0) return [];

  const revenueMap = new Map(segmentRevenues.map((s) => [s.segmentName, s.revenue]));
  const truncated = item1Text.length > 22000 ? item1Text.slice(0, 22000) + "\n\n[Truncated.]" : item1Text;

  const userContent = `Segment names to summarize (in order): ${segmentNames.join(" | ")}

Use the following 10-K Item 1 text to write one short paragraph per segment explaining what each segment does. Keep each paragraph in plain English and in the same order as the segment names above.

---
${truncated}`;

  const raw = await llmComplete(provider, SEGMENT_SUMMARY_SYSTEM, userContent, 2000, models, apiKeys, responseVerbosity);

  const paragraphs = raw
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const results: SegmentSummary[] = [];
  for (let i = 0; i < segmentNames.length; i++) {
    const name = segmentNames[i];
    const description = paragraphs[i] ?? "Description not clearly disclosed.";
    const revenue = revenueMap.get(name);
    let pctOfTotal: number | undefined;
    if (totalRevenue != null && totalRevenue > 0 && typeof revenue === "number" && revenue >= 0) {
      pctOfTotal = Math.round((revenue / totalRevenue) * 1000) / 10;
    }
    results.push({ segmentName: name, description, revenue, pctOfTotal });
  }
  return results;
}
