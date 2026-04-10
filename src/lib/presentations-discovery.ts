/**
 * Server-only: management presentation discovery via Claude (web search) or OpenAI / Gemini / DeepSeek (no live web).
 * Do not import in client.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { callClaude, type ClaudeResult, WEB_SEARCH_TOOL } from "@/lib/anthropic";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { ResponseVerbosity } from "@/lib/llm-response-verbosity";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

const USER_PROMPT_TEMPLATE =
  "Show me the latest 10 management presentations from [TICKER]. Use web search to find the company's investor relations page and current presentation links. Include management transcripts for each event when available, and include a ROIC.AI transcript link per event when possible (https://www.roic.ai/quote/[TICKER]/transcripts). Return only the list of results with title and link (and transcript link). No introduction, no explanation, no commentary.";

const OPENAI_SYSTEM = `You do not have live web access. The user wants up to 10 recent management / investor presentations for a public company.

Using only your training knowledge, list plausible presentation titles and URLs (IR site, earnings deck hosts, SEC exhibit links if you recall them). Clearly mark uncertainty: prefer saying "verify" or "check IR site" when you are not sure a URL still works.

Output format only: one line per item with a short title and a full URL. No introduction or commentary. If you cannot name real URLs, give the company's likely investor relations page pattern and tell the user to browse there.`;

/**
 * Claude with web search — best for current links (enable web search in Anthropic Console).
 */
export async function discoverPresentationsWithClaude(
  ticker: string,
  claudeModel: string,
  apiKeys: LlmCallApiKeys,
  responseVerbosity?: ResponseVerbosity
): Promise<ClaudeResult> {
  const safeTicker = ticker.trim().toUpperCase();
  if (!safeTicker) return { ok: false, error: "Ticker required" };
  const userMessage = USER_PROMPT_TEMPLATE.replace("[TICKER]", safeTicker);
  const systemPrompt =
    "Use web search to find the company's investor relations or presentations page, then list the latest 10 management events with presentation materials (earnings, investor day, conference/fireside chat, financing). For each item include: title + presentation URL, and if a transcript exists include a transcript URL. Prefer ROIC.AI for transcript links when possible: https://www.roic.ai/quote/{TICKER}/transcripts (or /transcripts/{YEAR}/{QUARTER} for a specific call). Output only the list: one line per item. No other text.";
  return callClaude(systemPrompt, userMessage, {
    maxTokens: 4096,
    model: claudeModel,
    tools: [WEB_SEARCH_TOOL],
    apiKeys,
    responseVerbosity,
  });
}

export type PresentationLlmModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel?: string;
};

export async function discoverPresentations(
  ticker: string,
  provider: AiProvider,
  models: PresentationLlmModels,
  apiKeys: LlmCallApiKeys,
  responseVerbosity?: ResponseVerbosity
): Promise<ClaudeResult> {
  if (provider === "claude") {
    return discoverPresentationsWithClaude(ticker, models.claudeModel, apiKeys, responseVerbosity);
  }
  const safeTicker = ticker.trim().toUpperCase();
  if (!safeTicker) return { ok: false, error: "Ticker required" };
  const userMessage = `Ticker: ${safeTicker}\n\nList up to 10 management or investor presentations (titles + working or best-known URLs). Training-data only; user will verify links.`;
  if (provider === "deepseek") {
    return llmCompleteSingle("deepseek", OPENAI_SYSTEM, userMessage, {
      maxTokens: 4096,
      deepseekModel: models.deepseekModel,
      apiKeys,
      responseVerbosity,
    });
  }
  if (provider === "gemini") {
    return llmCompleteSingle("gemini", OPENAI_SYSTEM, userMessage, {
      maxTokens: 4096,
      geminiModel: models.geminiModel,
      apiKeys,
      responseVerbosity,
    });
  }
  return llmCompleteSingle("openai", OPENAI_SYSTEM, userMessage, {
    maxTokens: 4096,
    openaiModel: models.openaiModel,
    apiKeys,
    responseVerbosity,
  });
}
