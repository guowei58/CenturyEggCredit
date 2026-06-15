/** Client-safe types/helpers for distressed doc review prompt background (no server imports). */

export type CreditDocReviewBackground = {
  capitalStructureNotes: string | null;
  orgChartNotes: string | null;
};

export const DOC_REVIEW_DOCUMENT_INSTRUCTION_MARKER =
  "The full document is at the SOURCE DOCUMENT LINK at the end of this prompt.";

const BACKGROUND_INSERT_MARKER = DOC_REVIEW_DOCUMENT_INSTRUCTION_MARKER;

export function appendRelevantBackgroundToDocReviewPrompt(
  basePrompt: string,
  background: CreditDocReviewBackground
): string {
  const cs = background.capitalStructureNotes?.trim() ?? "";
  const oc = background.orgChartNotes?.trim() ?? "";

  const sectionLines = [
    "",
    "==================================================",
    "RELEVANT BACKGROUND INFORMATION",
    "==================================================",
    "",
  ];
  if (cs) {
    sectionLines.push("Capital Structure — Notes tab", "", cs, "");
  }
  if (oc) {
    sectionLines.push("Org Chart — Notes tab", "", oc, "");
  }

  const section = sectionLines.join("\n");
  if (basePrompt.includes(BACKGROUND_INSERT_MARKER)) {
    return basePrompt.replace(BACKGROUND_INSERT_MARKER, `${section}\n${BACKGROUND_INSERT_MARKER}`);
  }
  return `${basePrompt.trim()}\n\n${section}`;
}

export const EMPTY_CREDIT_DOC_REVIEW_BACKGROUND: CreditDocReviewBackground = {
  capitalStructureNotes: null,
  orgChartNotes: null,
};
