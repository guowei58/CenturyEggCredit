import type { CreditMemoEvidenceDiagnostics } from "@/lib/creditMemo/kpiRetrieval";
import type { MemoOutline } from "@/lib/creditMemo/types";
import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";

/** Source pack + outline cached once; voice/deck instructions swap without re-embedding. */
export type MemoPromptSharedContext = {
  fingerprint: string;
  projectId: string;
  outline: MemoOutline;
  templateMetaLine: string;
  templateHintsBlock: string;
  inventory: string;
  evidence: string;
  docxTemplateApplied: boolean;
  memoTitle: string;
  ticker: string;
  targetWords: number;
  useTemplate: boolean;
  userMessageBreakdown: LmeUserMessageCharBreakdown;
  evidenceDiagnostics: CreditMemoEvidenceDiagnostics;
  retrievalUsed: boolean;
  builtAt: string;
};

export function buildMemoPromptSharedContextFingerprint(params: {
  projectId: string;
  sourceRelPaths: string[];
  targetWords: number;
  useTemplate: boolean;
  memoTitle: string;
}): string {
  const paths = [...params.sourceRelPaths].sort().join("\n");
  return [
    params.projectId,
    paths,
    String(params.targetWords),
    params.useTemplate ? "1" : "0",
    params.memoTitle.trim(),
  ].join("\u0001");
}
