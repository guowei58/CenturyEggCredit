import { CREDIT_MEMO_SYSTEM_PROMPT } from "@/data/credit-memo-llm-prompt";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { ResponseVerbosity } from "@/lib/llm-response-verbosity";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import { loadCreditMemoConfig } from "./config";
import { planMemoOutline, planMemoOutlineFromTemplate } from "./memoPlanner";
import type { CreditMemoProject, MemoJob, MemoOutline } from "./types";
import { getActiveCreditMemoTemplate } from "./templateStore";
import { ensureAllOutlineSectionsInMarkdown } from "./memoSectionCoverage";

function estimateTokensFromChars(chars: number): number {
  // Rough heuristic: ~4 chars/token for English prose.
  // We use this only to avoid hard request failures; it's intentionally conservative.
  return Math.ceil(chars / 4);
}

function buildUserPrompt(params: {
  memoTitle: string;
  ticker: string;
  outline: MemoOutline;
  sourceNotes: string;
  templateMetaLine: string;
  inventory: string;
  evidence: string;
}): string {
  const { memoTitle, ticker, outline, sourceNotes, templateMetaLine, inventory, evidence } = params;
  return `
# MEMO REQUEST
Title: ${memoTitle}
Ticker: ${ticker}

# OUTLINE & WORD BUDGET
Target length: ~${outline.totalWordBudget} words total (section budgets below should sum to roughly this scale).
${sourceNotes}
${templateMetaLine ? `\n${templateMetaLine}\n` : ""}

Required sections (include each as ## in this order; use only [need additional information] as the body when the EVIDENCE has nothing usable for that section):
${outline.sections.map((s) => `- ${s.title}: ~${s.targetWords} words — ${s.emphasis}`).join("\n")}

# FILE INVENTORY
${inventory}

# EVIDENCE
${evidence}

---
Write the complete credit memo in Markdown now. Include **every** required section above as \`## <exact title>\`, in order—none may be omitted. Write in **full paragraphs and complete sentences** where you have evidence; use the per-section word budgets with substantive prose. For sections with no evidence, body = only \`[need additional information]\`. Cite sources inline for all material facts and figures as specified in your system rules.
`.trim();
}

export type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

export async function runMemoGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  targetWords: number;
  memoTitle: string;
  provider: AiProvider;
  useTemplate?: boolean;
  voiceSystemPrompt?: string | null;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
  responseVerbosity?: ResponseVerbosity;
}): Promise<
  | { ok: true; outline: MemoOutline; markdown: string; sourcePack: string }
  | { ok: false; error: string }
> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  if (params.project.sources.length === 0) {
    return { ok: false, error: "No sources ingested. Run ingest after selecting a folder with files." };
  }

  let outline = planMemoOutline(params.targetWords, params.project.sources);
  let templateMetaLine = "";
  if (params.useTemplate) {
    const tpl = await getActiveCreditMemoTemplate(params.userId);
    if (tpl && tpl.outlineTitles.length > 0) {
      outline = planMemoOutlineFromTemplate({
        targetWords: params.targetWords,
        sources: params.project.sources,
        templateTitles: tpl.outlineTitles,
      });
      templateMetaLine = `Template outline: ${tpl.filename} (${tpl.uploadedAt})`;
    } else {
      templateMetaLine = "Template outline requested but no template is configured (using default outline).";
    }
  }
  const inventory = formatSourceInventoryList(params.project.sources);

  // Auto-fit the SOURCE PACK into the provider/model context window to avoid hard failures.
  // OpenAI errors out once the prompt exceeds its max context (seen as "prompt is too long").
  const PROMPT_TOKEN_LIMIT =
    ai === "openai" || ai === "gemini" || ai === "deepseek" ? 190_000 : 180_000;
  const SYSTEM_TOKEN_EST = estimateTokensFromChars(CREDIT_MEMO_SYSTEM_PROMPT.length);

  let maxEvidenceChars = cfg.maxContextChars;
  const evidenceQuery = `${params.memoTitle}\n${outline.sections.map((s) => s.title).join("\n")}\n${outline.sourceNotes}`.trim();
  let evidence = buildEvidencePackSync(params.project, { maxChars: maxEvidenceChars, query: evidenceQuery });
  let user = buildUserPrompt({
    memoTitle: params.memoTitle,
    ticker: params.project.ticker,
    outline,
    sourceNotes: outline.sourceNotes,
    templateMetaLine,
    inventory,
    evidence,
  });

  for (let i = 0; i < 8; i++) {
    const est = SYSTEM_TOKEN_EST + estimateTokensFromChars(user.length);
    if (est <= PROMPT_TOKEN_LIMIT) break;
    maxEvidenceChars = Math.max(40_000, Math.floor(maxEvidenceChars * 0.8));
    evidence = buildEvidencePackSync(params.project, { maxChars: maxEvidenceChars, query: evidenceQuery });
    user = buildUserPrompt({
      memoTitle: params.memoTitle,
      ticker: params.project.ticker,
      outline,
      sourceNotes: outline.sourceNotes,
      templateMetaLine,
      inventory,
      evidence,
    });
  }

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const system =
    (params.voiceSystemPrompt && params.voiceSystemPrompt.trim()
      ? `${CREDIT_MEMO_SYSTEM_PROMPT}\n\n# VOICE / STYLE (apply in addition to the above system rules)\n${params.voiceSystemPrompt.trim()}\n`
      : CREDIT_MEMO_SYSTEM_PROMPT
    ).trim();

  const result = await llmCompleteSingle(ai, system, user, {
    maxTokens: cfg.maxOutputTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
    responseVerbosity: params.responseVerbosity,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  const markdown = ensureAllOutlineSectionsInMarkdown(result.text.trim(), outline);
  return { ok: true, outline, markdown, sourcePack: evidence };
}

export function memoJobFromRun(
  id: string,
  project: CreditMemoProject,
  targetWords: number,
  memoTitle: string,
  provider: AiProvider,
  outline: MemoOutline | null,
  markdown: string | null,
  sourcePack: string | null,
  error: string | null
): MemoJob {
  const now = new Date().toISOString();
  const done = Boolean(markdown || error);
  return {
    id,
    projectId: project.id,
    ticker: project.ticker,
    targetWords,
    memoTitle,
    provider,
    status: error ? "failed" : markdown ? "completed" : "pending",
    outline,
    markdown,
    sourcePack,
    error,
    startedAt: now,
    completedAt: done ? now : null,
    createdAt: now,
  };
}
