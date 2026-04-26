import {
  buildBiblicalReferencesSystemPrompt,
  buildBiblicalReferencesUserPrompt,
} from "@/data/biblical-references-prompt";
import { pickBestConfiguredLiteraryProvider } from "@/lib/creditMemo/generateLiteraryReferences";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import { readPreferredSavedCreditMemoMarkdown } from "./savedMemoForReferenceTabs";
import { loadCreditMemoConfig } from "./config";
import type { CreditMemoProject } from "./types";

type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

const TXT_EVIDENCE_QUERY = [
  "Company narrative strategy risks liquidity leverage covenant",
  "Management turnaround restructuring industry competitive",
  "Earnings debt maturity refinancing thesis",
].join("\n");

/** Same provider preference as Literary References (Claude → OpenAI → Gemini → DeepSeek). */
export const pickBestConfiguredBiblicalProvider = pickBestConfiguredLiteraryProvider;

export async function runBiblicalReferencesGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  companyName?: string;
  provider: AiProvider;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
}): Promise<{ ok: true; markdown: string; sourcePack: string } | { ok: false; error: string }> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  const memoPick = await readPreferredSavedCreditMemoMarkdown(params.project.ticker, params.userId);
  const memoRaw = memoPick?.text ?? "";
  const memoSourceFilename = memoPick ? `${memoPick.saveKey}.md` : "";
  const txtSourceIds = new Set(
    params.project.sources.filter((s) => s.ext.toLowerCase() === "txt" && s.parseStatus !== "skipped").map((s) => s.id)
  );

  let inventory: string;
  let materials: string;

  if (memoPick && memoSourceFilename) {
    materials =
      `<<<BEGIN SOURCE: ${memoSourceFilename} (saved credit memo) | synthetic>>>\n` +
      memoRaw +
      `\n<<<END SOURCE: ${memoSourceFilename}>>>\n`;
    inventory = `- ${memoSourceFilename} (saved credit memo, primary — ${memoRaw.length} chars)`;
  } else if (params.project.sources.length === 0) {
    return {
      ok: false,
      error:
        "No ingested research folder and no saved credit memo (default or voice). Generate a memo on **AI Memo and Deck**, or run **Recommendation** once to ingest your folder (include .txt files if you have no memo yet).",
    };
  } else if (txtSourceIds.size > 0) {
    inventory = formatSourceInventoryList(params.project.sources.filter((s) => txtSourceIds.has(s.id)));
    materials = buildEvidencePackSync(params.project, {
      maxChars: cfg.maxContextChars,
      query: TXT_EVIDENCE_QUERY,
      sourceIds: txtSourceIds,
    });
  } else {
    inventory = formatSourceInventoryList(params.project.sources);
    materials = buildEvidencePackSync(params.project, {
      maxChars: cfg.maxContextChars,
      query: TXT_EVIDENCE_QUERY,
    });
  }

  const system = buildBiblicalReferencesSystemPrompt(params.project.ticker, params.companyName);
  const user = buildBiblicalReferencesUserPrompt({ inventory, materials });

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const result = await llmCompleteSingle(ai, system, user, {
    maxTokens: cfg.maxOutputTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  return { ok: true, markdown: result.text.trim(), sourcePack: materials };
}
