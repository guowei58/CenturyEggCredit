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
import { formatWorkProductPromptForExternalCopy } from "@/lib/work-product-prompt-format";
import {
  buildCreditMemoUserPrompt,
  rebuildCreditMemoPromptFromSharedContext,
} from "@/lib/creditMemo/memoPromptAssembly";
import {
  buildMemoPromptSharedContextFingerprint,
  type MemoPromptSharedContext,
} from "@/lib/creditMemo/memoPromptSharedContext";

export { rebuildCreditMemoPromptFromSharedContext };
export type { MemoPromptSharedContext };

function buildMemoSystemPrompt(params: {
  voiceSystemPrompt?: string | null;
  docxTemplateApplied: boolean;
}): string {
  const useCharacterVoice = Boolean(params.voiceSystemPrompt?.trim());
  const templateSystemExtra = params.docxTemplateApplied
    ? `

## Firm DOCX template (mandatory structure)
The user is using an uploaded Word template. The user message lists **VERBATIM SECTION HEADINGS** and may include **TEMPLATE DOC** excerpts showing what appeared under each heading in the file. You must (1) use those \`##\` titles exactly and in order, and (2) let the excerpts inform what each section should cover—while writing only facts supported by the evidence in the user message.
`.trim()
    : "";

  return (
    (useCharacterVoice ? params.voiceSystemPrompt!.trim() : CREDIT_MEMO_SYSTEM_PROMPT) +
    (templateSystemExtra ? `\n\n${templateSystemExtra}` : "")
  ).trim();
}

export type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

export async function buildCreditMemoPromptPackage(params: {
  userId: string;
  project: CreditMemoProject;
  targetWords: number;
  memoTitle: string;
  useTemplate?: boolean;
  voiceSystemPrompt?: string | null;
  apiKeys: LlmCallApiKeys;
}): Promise<
  | {
      ok: true;
      outline: MemoOutline;
      systemPrompt: string;
      userPrompt: string;
      copyPrompt: string;
      sourcePack: string;
      sharedContext: MemoPromptSharedContext;
      userMessageBreakdown: LmeUserMessageCharBreakdown;
      evidenceDiagnostics: CreditMemoEvidenceDiagnostics;
      retrievalUsed: boolean;
    }
  | { ok: false; error: string }
> {
  if (params.project.sources.length === 0) {
    return { ok: false, error: 'Please click "Refresh sources" first.' };
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

  const system = buildMemoSystemPrompt({
    voiceSystemPrompt: params.voiceSystemPrompt,
    docxTemplateApplied,
  });

  const evidenceQuery = `${params.memoTitle}\n${outline.sections.map((s) => s.title).join("\n")}\n${outline.sourceNotes}`.trim();
  const { evidence, diagnostics } = await resolveCreditMemoEvidencePack({
    userId: params.userId,
    project: params.project,
    apiKeys: params.apiKeys,
    query: evidenceQuery,
  });
  const useCharacterVoice = Boolean(params.voiceSystemPrompt?.trim());
  const user = buildCreditMemoUserPrompt({
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
  const fingerprint = buildMemoPromptSharedContextFingerprint({
    projectId: params.project.id,
    sourceRelPaths: params.project.sources.map((s) => s.relPath),
    targetWords: params.targetWords,
    useTemplate: params.useTemplate !== false,
    memoTitle: params.memoTitle,
  });
  const sharedContext: MemoPromptSharedContext = {
    fingerprint,
    projectId: params.project.id,
    outline,
    templateMetaLine,
    templateHintsBlock,
    inventory,
    evidence,
    docxTemplateApplied,
    memoTitle: params.memoTitle,
    ticker: params.project.ticker,
    targetWords: params.targetWords,
    useTemplate: params.useTemplate !== false,
    userMessageBreakdown,
    evidenceDiagnostics: diagnostics,
    retrievalUsed: diagnostics.mode === "retrieval",
    builtAt: new Date().toISOString(),
  };

  return {
    ok: true,
    outline,
    systemPrompt: system,
    userPrompt: user,
    copyPrompt: formatWorkProductPromptForExternalCopy(system, user),
    sourcePack: evidence,
    sharedContext,
    userMessageBreakdown,
    evidenceDiagnostics: diagnostics,
    retrievalUsed: diagnostics.mode === "retrieval",
  };
}

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
  temperature?: number;
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

  const built = await buildCreditMemoPromptPackage({
    userId: params.userId,
    project: params.project,
    targetWords: params.targetWords,
    memoTitle: params.memoTitle,
    useTemplate: params.useTemplate,
    voiceSystemPrompt: params.voiceSystemPrompt,
    apiKeys: params.apiKeys,
  });
  if (!built.ok) {
    return built;
  }

  const {
    outline,
    systemPrompt: system,
    userPrompt: user,
    sourcePack: evidence,
    userMessageBreakdown,
    evidenceDiagnostics: diagnostics,
    retrievalUsed,
  } = built;

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
    retrievalUsed,
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
