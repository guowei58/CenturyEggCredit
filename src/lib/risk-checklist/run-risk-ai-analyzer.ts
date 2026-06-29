import type { AiProvider } from "@/lib/ai-provider";
import { resolveLmeAnalysisModels, type ModelOverrideBody } from "@/lib/ai-model-from-request";
import { augmentLlmFullSystemPrompt } from "@/lib/llm-datetime-context";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { llmApiErrorResponseBody } from "@/lib/llm-api-error-report";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import {
  formatRiskChecklistSourcesForPrompt,
  gatherRiskChecklistSavedSources,
} from "./ai-analyzer-sources";
import { parseRiskAiAnswersJson } from "./parse-risk-ai-answers";
import { findIssuerDraftForAnalyze, saveRiskAnswers } from "./store";
import type { RiskAnswerLabel } from "./types";

const SYSTEM_PROMPT = `You are a senior credit analyst completing a standardized issuer risk checklist.

You will receive saved research responses for a company and a list of risk questions. For each question, choose exactly one answer label based only on evidence in the supplied materials.

Answer labels (risk increases left to right):
- "no" — the risk factor described is clearly not present or is immaterial
- "mixed" — partial / ambiguous / mixed evidence
- "yes" — the risk factor is clearly present
- "unknown" — insufficient evidence in the supplied materials to decide
- "not_applicable" — question does not apply to this issuer

Rules:
- Prefer "unknown" over guessing when the saved responses do not address a question.
- Use "not_applicable" sparingly and only when clearly irrelevant.
- Base answers on the saved responses only; do not invent facts.

Output ONLY valid JSON (no markdown prose outside the JSON) in this shape:
{
  "answers": [
    { "questionCode": "IBR-01", "answerLabel": "no", "rationale": "one short sentence citing evidence or lack thereof" }
  ]
}

Include one entry for every question code listed in the user message.`;

export async function runRiskAiAnalyzer(params: {
  userId: string;
  ticker: string;
  performedBy: string;
  provider: AiProvider;
  models?: ModelOverrideBody;
  apiKeys: LlmCallApiKeys;
  temperature: number;
  companyName?: string;
}) {
  const draft = await findIssuerDraftForAnalyze(params.userId, params.ticker);
  if (!draft) {
    return { ok: false as const, error: "No editable risk checklist found for this company." };
  }
  if (!draft.isEditable) {
    return { ok: false as const, error: "This assessment is completed and cannot be edited." };
  }

  const sources = await gatherRiskChecklistSavedSources(params.userId, params.ticker);
  if (sources.length === 0) {
    return {
      ok: false as const,
      error:
        "No saved tab responses found for this company. Save research in other tabs first (Overview, Financials, Work Product, etc.), then run AI Risk Analyzer.",
    };
  }

  if (!isProviderConfigured(params.provider, params.apiKeys)) {
    return { ok: false as const, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  const formatted = formatRiskChecklistSourcesForPrompt(params.ticker, sources);
  const questionLines = draft.questions.map(
    (q) => `- ${q.questionCode} [${q.categoryLabel}]: ${q.questionText}`
  );

  const userPrompt = [
    params.companyName ? `Company: ${params.companyName}` : null,
    `Ticker: ${params.ticker}`,
    "",
    formatted.text,
    "",
    "========== RISK CHECKLIST QUESTIONS ==========",
    "Answer every question code below.",
    ...questionLines,
  ]
    .filter(Boolean)
    .join("\n");

  const models = resolveLmeAnalysisModels(params.models ?? {});
  const llm = await llmCompleteSingle(params.provider, augmentLlmFullSystemPrompt(SYSTEM_PROMPT), userPrompt, {
    maxTokens: Math.min(LLM_MAX_OUTPUT_TOKENS, 16_000),
    apiKeys: params.apiKeys,
    temperature: params.temperature,
    claudeModel: models.claudeModel,
    openaiModel: models.openaiModel,
    geminiModel: models.geminiModel,
    deepseekModel: models.deepseekModel,
  });

  if (!llm.ok) {
    const errBody = llmApiErrorResponseBody({
      provider: params.provider,
      httpStatus: llm.status,
      rawError: llm.error,
    });
    return { ok: false as const, error: errBody.body.error };
  }

  const parsed = parseRiskAiAnswersJson(llm.text);
  if (!parsed) {
    return {
      ok: false as const,
      error: "AI response could not be parsed. Try again or switch model.",
    };
  }

  const codeToId = new Map(draft.questions.map((q) => [q.questionCode.toUpperCase(), q.id]));
  const answers = parsed.answers
    .map((a) => {
      const questionId = codeToId.get(a.questionCode.toUpperCase());
      if (!questionId) return null;
      return { questionId, answerLabel: a.answerLabel };
    })
    .filter((a): a is { questionId: string; answerLabel: RiskAnswerLabel } => a != null);

  if (answers.length === 0) {
    return { ok: false as const, error: "AI returned no matching question codes." };
  }

  const workspace = await saveRiskAnswers(params.userId, params.ticker, answers, params.performedBy);

  return {
    ok: true as const,
    workspace,
    sourceCount: sources.length,
    sourcesIncluded: formatted.included,
    totalSourceChars: formatted.totalChars,
    answeredCount: answers.length,
    questionCount: draft.questions.length,
  };
}
