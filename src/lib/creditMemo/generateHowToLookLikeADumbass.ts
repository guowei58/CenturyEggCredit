import {
  buildHowToLookLikeADumbassSystemPrompt,
  buildHowToLookLikeADumbassUserPrompt,
} from "@/data/how-to-look-like-a-dumbass-prompt";
import { pickBestConfiguredLiteraryProvider } from "@/lib/creditMemo/generateLiteraryReferences";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import {
  readPreferredSavedCreditMemoMarkdown,
  readSavedTabResponsePackForReferenceGeneration,
} from "./savedMemoForReferenceTabs";
import { loadCreditMemoConfig } from "./config";
import type { CreditMemoProject } from "./types";

type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

const TXT_EVIDENCE_QUERY = [
  "Distressed credit refinancing liquidity covenant leverage recovery bankruptcy",
  "Customer reputation risk margins EBITDA capital structure maturity wall",
  "Management turnaround restructuring industry competitive downside",
].join("\n");

export const pickBestConfiguredDumbassProvider = pickBestConfiguredLiteraryProvider;

export async function runHowToLookLikeADumbassGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  companyName?: string;
  targetSecurity?: string;
  tradingPrice?: string;
  provider: AiProvider;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
  temperature?: number;
}): Promise<{ ok: true; markdown: string; sourcePack: string } | { ok: false; error: string }> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  const memoPick = await readPreferredSavedCreditMemoMarkdown(params.project.ticker, params.userId);
  const tabPack = await readSavedTabResponsePackForReferenceGeneration(params.project.ticker, params.userId);
  const memoRaw = memoPick?.text ?? "";
  const memoSourceFilename = memoPick ? `${memoPick.saveKey}.md` : "";

  const inventoryParts: string[] = [];
  const materialParts: string[] = [];

  if (memoPick && memoSourceFilename) {
    materialParts.push(
      `<<<BEGIN SOURCE: ${memoSourceFilename} (saved credit memo) | synthetic>>>\n` +
        memoRaw +
        `\n<<<END SOURCE: ${memoSourceFilename}>>>`
    );
    inventoryParts.push(`- ${memoSourceFilename} (saved credit memo, primary — ${memoRaw.length} chars)`);
  }

  if (tabPack) {
    materialParts.push(tabPack.materials);
    inventoryParts.push(tabPack.inventory);
  }

  const txtSourceIds = new Set(
    params.project.sources.filter((s) => s.ext.toLowerCase() === "txt" && s.parseStatus !== "skipped").map((s) => s.id)
  );

  if (materialParts.length === 0) {
    if (params.project.sources.length === 0) {
      return {
        ok: false,
        error:
          "No saved credit memo or saved tab responses found for this workspace. Generate a memo on **AI Memo and Deck** and/or save text on research tabs (Overview, Risk from 10K, etc.), then try again.",
      };
    }
    if (txtSourceIds.size > 0) {
      inventoryParts.push(formatSourceInventoryList(params.project.sources.filter((s) => txtSourceIds.has(s.id))));
      materialParts.push(
        buildEvidencePackSync(params.project, {
          maxChars: cfg.maxContextChars,
          query: TXT_EVIDENCE_QUERY,
          sourceIds: txtSourceIds,
        })
      );
    } else {
      inventoryParts.push(formatSourceInventoryList(params.project.sources));
      materialParts.push(
        buildEvidencePackSync(params.project, {
          maxChars: cfg.maxContextChars,
          query: TXT_EVIDENCE_QUERY,
        })
      );
    }
  } else if (params.project.sources.length > 0) {
    inventoryParts.push(formatSourceInventoryList(params.project.sources));
    materialParts.push(
      buildEvidencePackSync(params.project, {
        maxChars: Math.min(cfg.maxContextChars, 120_000),
        query: TXT_EVIDENCE_QUERY,
      })
    );
  }

  const inventory = inventoryParts.filter(Boolean).join("\n");
  const materials = materialParts.filter(Boolean).join("\n\n");

  if (!materials.trim()) {
    return {
      ok: false,
      error:
        "No research materials available. Save tab responses or generate a credit memo, then try again.",
    };
  }

  const system = buildHowToLookLikeADumbassSystemPrompt(
    params.project.ticker,
    params.companyName,
    params.targetSecurity,
    params.tradingPrice
  );
  const user = buildHowToLookLikeADumbassUserPrompt({ inventory, materials });

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const result = await llmCompleteSingle(ai, system, user, {
    maxTokens: cfg.maxOutputTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
    temperature: params.temperature,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  return { ok: true, markdown: result.text.trim(), sourcePack: materials };
}
