import { Buffer } from "node:buffer";

import { gatherKpiCommentarySources, formatSourcesForKpiCommentary } from "@/lib/kpi-workspace-sources";
import type { LmeRunPackingStats } from "@/lib/lme-sources";
import { synthesizeKpiCommentaryMarkdown, type KpiCommentaryUserMessageBreakdown } from "@/lib/kpi-commentary-synthesis";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";

const NO_SOURCES_ERROR =
  "No substantive KPI sources found. Save at least one management presentation or earnings transcript from Period Financials, and/or save a Competitor Earnings ReadThrus response.";

export async function runKpiCommentaryFromTicker(params: {
  ticker: string;
  userId: string;
  provider: AiProvider;
  companyName?: string;
  models: CovenantResolvedModels;
  apiKeys: LlmCallApiKeys;
  temperature?: number;
}): Promise<
  | {
      ok: true;
      markdown: string;
      sourcePack: string;
      contextSentUtf8Bytes: number;
      sourceFingerprint: string;
      retrievalUsed: boolean;
      packingStats: LmeRunPackingStats;
      sentSystemMessage: string;
      sentUserMessage: string;
      userMessageBreakdown: KpiCommentaryUserMessageBreakdown;
    }
  | { ok: false; error: string }
> {
  const sym = params.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) {
    return { ok: false, error: "Invalid ticker" };
  }

  if (!isProviderConfigured(params.provider, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  const bundled = await gatherKpiCommentarySources(sym, undefined, params.userId, {
    apiKeys: params.apiKeys,
    useRetrieval: true,
  });

  if (!bundled.hasSubstantiveText) {
    return { ok: false, error: NO_SOURCES_ERROR };
  }

  const sourcePack = formatSourcesForKpiCommentary(sym, bundled.parts);
  const syn = await synthesizeKpiCommentaryMarkdown(
    sourcePack,
    sym,
    params.companyName,
    params.provider,
    params.models,
    params.apiKeys,
    params.temperature
  );

  if (!syn.ok) {
    return { ok: false, error: syn.error };
  }

  const packingStats = bundled.packingStats;
  if (!packingStats) {
    return { ok: false, error: "Internal error: missing packing stats." };
  }

  const contextSentUtf8Bytes =
    Buffer.byteLength(syn.sentSystemMessage, "utf8") + Buffer.byteLength(syn.sentUserMessage, "utf8");

  return {
    ok: true,
    markdown: syn.markdown,
    sourcePack,
    contextSentUtf8Bytes,
    sourceFingerprint: bundled.sourceFingerprint,
    retrievalUsed: bundled.retrievalUsed,
    packingStats,
    sentSystemMessage: syn.sentSystemMessage,
    sentUserMessage: syn.sentUserMessage,
    userMessageBreakdown: syn.userMessageBreakdown,
  };
}
