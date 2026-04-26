import { CREDIT_MEMO_SYSTEM_PROMPT } from "@/data/credit-memo-llm-prompt";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildTemplateDocxHintsBlock } from "./templatePromptBlocks";
import { resolveCreditMemoEvidencePack, type CreditMemoEvidenceDiagnostics } from "./kpiRetrieval";
import { loadCreditMemoConfig } from "./config";
import { planMemoOutline, planMemoOutlineFromTemplate } from "./memoPlanner";
import type { CreditMemoProject, MemoJob, MemoOutline } from "./types";
import { getActiveCreditMemoTemplate } from "./templateStore";
import { ensureAllOutlineSectionsInMarkdown } from "./memoSectionCoverage";
import { formatSourceInventoryList } from "./evidencePack";
import { computeMemoUserMessageBreakdown } from "./memoRunTelemetry";
import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";

function buildUserPrompt(params: {
  memoTitle: string;
  ticker: string;
  outline: MemoOutline;
  sourceNotes: string;
  templateMetaLine: string;
  templateHintsBlock: string;
  inventory: string;
  evidence: string;
  /** Character voice memos: user prompt stays factual but does not assume institutional credit-memo system rules. */
  characterVoice?: boolean;
}): string {
  const {
    memoTitle,
    ticker,
    outline,
    sourceNotes,
    templateMetaLine,
    templateHintsBlock,
    inventory,
    evidence,
    characterVoice,
  } = params;
  const verbatimHeadings = outline.sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
  const templateBodyGuidance = characterVoice
    ? "When a DOCX template is referenced above, the section list mirrors that template’s headings—**populate those sections in order** with substantive prose in your voice (not slide bullets), using the evidence pack."
    : "When a DOCX template is referenced above, the section list below mirrors that template’s heading structure—your output must **populate those sections in order** with institutional prose (not slide bullets), filling each with analysis grounded in the evidence pack.";

  const closing = characterVoice
    ? "Write the complete memo in Markdown now. Include every required section above using the exact ## titles listed, in order—none may be omitted. Use full paragraphs where you have material; honor the per-section word budgets. For sections with no usable evidence, the section body must be only the line: [need additional information]."
    : "Write the complete credit memo in Markdown now. Include every required section above using the exact ## titles listed, in order—none may be omitted. Write in full paragraphs and complete sentences where you have evidence; use the per-section word budgets with substantive prose. For sections with no evidence, the section body must be only the line: [need additional information]. Cite sources inline for all material facts and figures as specified in your system rules.";

  return `
# MEMO REQUEST
Title: ${memoTitle}
Ticker: ${ticker}

# OUTLINE & WORD BUDGET
Target length: ~${outline.totalWordBudget} words total (section budgets below should sum to roughly this scale).
${sourceNotes}
${templateMetaLine ? `\n${templateMetaLine}\n` : ""}
${templateHintsBlock ? `\n${templateHintsBlock}\n` : ""}

${templateBodyGuidance}

# VERBATIM SECTION HEADINGS (required Markdown \`##\` lines)
Your memo body must use **exactly** these section titles, **in this order**, with **no renaming, merging, or skipping**. Each heading line must be: two hash characters, one space, then the title string **character-for-character** as shown:
${verbatimHeadings}

For each section, write \`## <title>\` then a blank line then the section body.

# SECTION DETAIL (word targets & emphasis)
${outline.sections.map((s) => `- ${s.title}: ~${s.targetWords} words — ${s.emphasis}`).join("\n")}

# FILE INVENTORY
${inventory}

# EVIDENCE
${evidence}

---
${closing}
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
}): Promise<
  | {
      ok: true;
      outline: MemoOutline;
      markdown: string;
      sourcePack: string;
      sentSystemMessage: string;
      sentUserMessage: string;
      userMessageBreakdown: LmeUserMessageCharBreakdown;
      evidenceDiagnostics: CreditMemoEvidenceDiagnostics;
      retrievalUsed: boolean;
    }
  | { ok: false; error: string }
> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  if (params.project.sources.length === 0) {
    return { ok: false, error: 'Please click on "Refresh sources"' };
  }

  let outline = planMemoOutline(params.targetWords, params.project.sources);
  let templateMetaLine = "";
  let docxTemplateApplied = false;
  if (params.useTemplate) {
    const tpl = await getActiveCreditMemoTemplate(params.userId);
    if (tpl && tpl.outlineTitles.length > 0) {
      docxTemplateApplied = true;
      outline = planMemoOutlineFromTemplate({
        targetWords: params.targetWords,
        sources: params.project.sources,
        templateTitles: tpl.outlineTitles,
        templateSectionHints: tpl.sectionHints,
      });
      templateMetaLine = `Template outline: ${tpl.filename} (${tpl.uploadedAt})`;
    } else {
      templateMetaLine = "Template outline requested but no template is configured (using default outline).";
    }
  }
  const templateHintsBlock = docxTemplateApplied ? buildTemplateDocxHintsBlock(outline) : "";
  const inventory = formatSourceInventoryList(params.project.sources);

  const useCharacterVoice = Boolean(params.voiceSystemPrompt?.trim());
  const templateSystemExtra = docxTemplateApplied
    ? `

## Firm DOCX template (mandatory structure)
The user is using an uploaded Word template. The user message lists **VERBATIM SECTION HEADINGS** and may include **TEMPLATE DOC** excerpts showing what appeared under each heading in the file. You must (1) use those \`##\` titles exactly and in order, and (2) let the excerpts inform what each section should cover—while writing only facts supported by the evidence in the user message.
`.trim()
    : "";

  /** Character voices: standalone system prompt (voice + optional template block), no institutional credit-memo system prompt. */
  const system = (
    (useCharacterVoice ? params.voiceSystemPrompt!.trim() : CREDIT_MEMO_SYSTEM_PROMPT) +
    (templateSystemExtra ? `\n\n${templateSystemExtra}` : "")
  ).trim();

  const evidenceQuery = `${params.memoTitle}\n${outline.sections.map((s) => s.title).join("\n")}\n${outline.sourceNotes}`.trim();
  const { evidence, diagnostics } = await resolveCreditMemoEvidencePack({
    userId: params.userId,
    project: params.project,
    apiKeys: params.apiKeys,
    query: evidenceQuery,
  });
  const user = buildUserPrompt({
    memoTitle: params.memoTitle,
    ticker: params.project.ticker,
    outline,
    sourceNotes: outline.sourceNotes,
    templateMetaLine,
    templateHintsBlock,
    inventory,
    evidence,
    characterVoice: useCharacterVoice,
  });
  const userMessageBreakdown = computeMemoUserMessageBreakdown(user, evidence);

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

  const markdown = ensureAllOutlineSectionsInMarkdown(result.text.trim(), outline);
  return {
    ok: true,
    outline,
    markdown,
    sourcePack: evidence,
    sentSystemMessage: system,
    sentUserMessage: user,
    userMessageBreakdown,
    evidenceDiagnostics: diagnostics,
    retrievalUsed: diagnostics.mode === "retrieval",
  };
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
