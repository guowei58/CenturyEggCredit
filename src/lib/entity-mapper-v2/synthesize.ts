import { ENTITY_MAPPER_V2_SYSTEM_PROMPT } from "@/data/entity-mapper-v2-prompt";
import { DEEPSEEK_MAX_OUTPUT_TOKENS, LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { AiProvider } from "@/lib/ai-provider";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

import type { Exhibit21UniverseRow } from "@/lib/entity-mapper-v2/types";
import type { DebtInventoryItem } from "@/lib/entity-mapper-v2/types";

export function buildEntityMapperV2UserPayload(params: {
  ticker: string;
  companyName: string | null;
  cik: string | null;
  universe: Exhibit21UniverseRow[];
  inventory: DebtInventoryItem[];
  inventoryFamilies: string[];
  sourcesFormatted: string;
}): string {
  const sym = params.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const uniLines = params.universe.map(
    (u, i) =>
      `${i + 1}. ${u.exhibit21LegalName}${u.jurisdiction ? ` | Jurisdiction: ${u.jurisdiction}` : ""} | normalized: ${u.normalizedLegalName}`
  );
  const invSlice = params.inventory.slice(0, 140);
  return [
    `## RUN CONTEXT`,
    `Ticker: ${sym}`,
    `Company name: ${params.companyName?.trim() || "(not provided)"}`,
    `CIK: ${params.cik?.trim() || "(not provided)"}`,
    ``,
    `## EXHIBIT 21 SUBSIDIARY UNIVERSE (${params.universe.length} entities)`,
    `These names are the authoritative row index. Match financing-document text to these names using exact match first, then careful normalization — do not merge distinct entities.`,
    ...uniLines,
    ``,
    `## DEBT DOCUMENT INVENTORY (EDGAR pass — metadata only; roles still require SOURCE DOCUMENTS)`,
    `Families detected: ${params.inventoryFamilies.join("; ") || "(none)"}`,
    "```json",
    JSON.stringify(invSlice, null, 0),
    "```",
    ``,
    `## SOURCE DOCUMENTS`,
    params.sourcesFormatted,
    ``,
    `## ALSO REQUIRED IN JSON OUTPUT`,
    `Populate subsidiaries_not_in_exhibit21 per FORENSIC SUBSIDIARY GUIDANCE in the system prompt: financing-relevant entities in SOURCE DOCUMENTS not on the Exhibit 21 universe after normalization; include importance_flag, likely_role, parent/jurisdiction/source_citation_detail when supported by text. Populate llm_notes with a brief executive summary (structure complexity, counts, buckets, Exhibit 21 vs supplemental corpus).`,
  ].join("\n");
}

export async function synthesizeEntityMapperV2Json(params: {
  userPayload: string;
  provider: AiProvider;
  models: CovenantResolvedModels;
  apiKeys: LlmCallApiKeys;
}): Promise<{ ok: true; rawText: string } | { ok: false; error: string }> {
  const maxOut =
    params.provider === "deepseek" ? DEEPSEEK_MAX_OUTPUT_TOKENS : LLM_MAX_OUTPUT_TOKENS;
  const user =
    params.userPayload +
    `\n\n---\nRespond with ONE JSON object only (no prose outside JSON), following the schema in your system instructions.`;

  const result = await llmCompleteSingle(params.provider, ENTITY_MAPPER_V2_SYSTEM_PROMPT, user, {
    maxTokens: maxOut,
    claudeModel: params.models.claudeModel,
    openaiModel: params.models.openaiModel,
    geminiModel: params.models.geminiModel,
    deepseekModel: params.models.deepseekModel,
    apiKeys: params.apiKeys,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, rawText: result.text };
}
