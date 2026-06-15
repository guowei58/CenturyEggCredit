/**
 * Client-safe memo prompt assembly (no DB / retrieval). Used to swap voice instructions
 * over a cached source pack without re-embedding.
 */

import { CREDIT_MEMO_SYSTEM_PROMPT } from "@/data/credit-memo-llm-prompt";
import type { CreditMemoEvidenceDiagnostics } from "@/lib/creditMemo/kpiRetrieval";
import type { MemoPromptSharedContext } from "@/lib/creditMemo/memoPromptSharedContext";
import type { MemoOutline } from "@/lib/creditMemo/types";
import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";
import { formatWorkProductPromptForExternalCopy } from "@/lib/work-product-prompt-format";

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

export function buildCreditMemoUserPrompt(params: {
  memoTitle: string;
  ticker: string;
  outline: MemoOutline;
  sourceNotes: string;
  templateMetaLine: string;
  templateHintsBlock: string;
  inventory: string;
  evidence: string;
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

export function rebuildCreditMemoPromptFromSharedContext(
  shared: MemoPromptSharedContext,
  voiceSystemPrompt?: string | null
): {
  outline: MemoOutline;
  systemPrompt: string;
  userPrompt: string;
  copyPrompt: string;
  retrievalUsed: boolean;
  userMessageBreakdown: LmeUserMessageCharBreakdown;
  evidenceDiagnostics: CreditMemoEvidenceDiagnostics;
} {
  const useCharacterVoice = Boolean(voiceSystemPrompt?.trim());
  const system = buildMemoSystemPrompt({
    voiceSystemPrompt,
    docxTemplateApplied: shared.docxTemplateApplied,
  });
  const user = buildCreditMemoUserPrompt({
    memoTitle: shared.memoTitle,
    ticker: shared.ticker,
    outline: shared.outline,
    sourceNotes: shared.outline.sourceNotes,
    templateMetaLine: shared.templateMetaLine,
    templateHintsBlock: shared.templateHintsBlock,
    inventory: shared.inventory,
    evidence: shared.evidence,
    characterVoice: useCharacterVoice,
  });
  return {
    outline: shared.outline,
    systemPrompt: system,
    userPrompt: user,
    copyPrompt: formatWorkProductPromptForExternalCopy(system, user),
    retrievalUsed: shared.retrievalUsed,
    userMessageBreakdown: shared.userMessageBreakdown,
    evidenceDiagnostics: shared.evidenceDiagnostics,
  };
}
