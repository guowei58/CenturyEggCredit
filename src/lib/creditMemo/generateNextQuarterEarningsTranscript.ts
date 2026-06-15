import {
  buildNextQuarterEarningsTranscriptSystemPrompt,
  buildNextQuarterEarningsTranscriptUserPrompt,
} from "@/data/next-quarter-earnings-transcript-prompt";
import { pickBestConfiguredLiteraryProvider } from "@/lib/creditMemo/generateLiteraryReferences";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import { fetchRoicHistoricalTranscriptPack } from "./roicEarningsTranscriptPack";
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
  "Earnings revenue guidance margin EBITDA segment bookings demand pricing",
  "Management outlook macro industry competitor customer churn renewal",
  "Quarterly results transcript analyst questions capital allocation liquidity",
].join("\n");

export const pickBestConfiguredEarningsTranscriptProvider = pickBestConfiguredLiteraryProvider;

export async function runNextQuarterEarningsTranscriptGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  companyName?: string;
  nextQuarter?: string;
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
  const roicPack = await fetchRoicHistoricalTranscriptPack(params.project.ticker);
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

  if (roicPack) {
    materialParts.push(roicPack.materials);
    inventoryParts.push(roicPack.inventory);
  }

  const txtSourceIds = new Set(
    params.project.sources.filter((s) => s.ext.toLowerCase() === "txt" && s.parseStatus !== "skipped").map((s) => s.id)
  );

  if (materialParts.length === 0) {
    if (params.project.sources.length === 0) {
      return {
        ok: false,
        error:
          "No saved credit memo or saved tab responses found for this workspace. Generate a memo on **AI Memo and Deck** and/or save text on research tabs, then try again.",
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
      error: "No research materials available. Save tab responses or generate a credit memo, then try again.",
    };
  }

  const system = buildNextQuarterEarningsTranscriptSystemPrompt(
    params.project.ticker,
    params.companyName,
    params.nextQuarter
  );
  const user = buildNextQuarterEarningsTranscriptUserPrompt({ inventory, materials });

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
