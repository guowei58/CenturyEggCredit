import {
  buildLiteraryReferencesSystemPrompt,
  buildLiteraryReferencesUserPrompt,
} from "@/data/literary-references-prompt";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import {
  readPreferredSavedCreditMemoMarkdown,
  REFERENCE_GEN_MIN_MEMO_CHARS,
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
  "Company narrative strategy risks liquidity leverage covenant",
  "Management turnaround restructuring industry competitive",
  "Earnings debt maturity refinancing thesis",
].join("\n");

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Prefer Claude, then OpenAI, Gemini, DeepSeek — first with a configured key. */
export function pickBestConfiguredLiteraryProvider(keys: LlmCallApiKeys | undefined): AiProvider | null {
  const order: AiProvider[] = ["claude", "openai", "gemini", "deepseek"];
  for (const p of order) {
    if (isProviderConfigured(p, keys)) return p;
  }
  return null;
}

export async function runLiteraryReferencesGeneration(params: {
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
  let memoCap = 0;

  if (memoPick && memoSourceFilename) {
    const cap = Math.min(memoRaw.length, cfg.maxContextChars - 50_000);
    memoCap = Math.min(memoRaw.length, cap);
    materials =
      `<<<BEGIN SOURCE: ${memoSourceFilename} (saved credit memo) | synthetic>>>\n` +
      (memoRaw.length > cap ? `${memoRaw.slice(0, cap)}\n…[truncated]` : memoRaw) +
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

  const system = buildLiteraryReferencesSystemPrompt(params.project.ticker, params.companyName);
  let user = buildLiteraryReferencesUserPrompt({ inventory, materials });

  const PROMPT_TOKEN_LIMIT =
    ai === "openai" || ai === "gemini" || ai === "deepseek" ? 190_000 : 180_000;
  const SYSTEM_TOKEN_EST = estimateTokensFromChars(system.length);
  let evidenceMaxChars = cfg.maxContextChars;

  for (let i = 0; i < 10; i++) {
    const est = SYSTEM_TOKEN_EST + estimateTokensFromChars(user.length);
    if (est <= PROMPT_TOKEN_LIMIT) break;

    if (memoCap > 0 && memoSourceFilename) {
      memoCap = Math.max(REFERENCE_GEN_MIN_MEMO_CHARS, Math.floor(memoCap * 0.85));
      const clipped = memoRaw.slice(0, memoCap);
      materials =
        `<<<BEGIN SOURCE: ${memoSourceFilename} (saved credit memo) | synthetic>>>\n${clipped}\n…[truncated]\n<<<END SOURCE: ${memoSourceFilename}>>>\n`;
      user = buildLiteraryReferencesUserPrompt({ inventory, materials });
      continue;
    }

    evidenceMaxChars = Math.max(40_000, Math.floor(evidenceMaxChars * 0.85));
    if (txtSourceIds.size > 0) {
      materials = buildEvidencePackSync(params.project, {
        maxChars: evidenceMaxChars,
        query: TXT_EVIDENCE_QUERY,
        sourceIds: txtSourceIds,
      });
    } else {
      materials = buildEvidencePackSync(params.project, {
        maxChars: evidenceMaxChars,
        query: TXT_EVIDENCE_QUERY,
      });
    }
    user = buildLiteraryReferencesUserPrompt({ inventory, materials });
  }

  if (SYSTEM_TOKEN_EST + estimateTokensFromChars(user.length) > PROMPT_TOKEN_LIMIT) {
    return {
      ok: false,
      error:
        "Research materials are still too large for one model request. Try a shorter saved memo, fewer/lighter .txt files, or raise limits in server config.",
    };
  }

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
