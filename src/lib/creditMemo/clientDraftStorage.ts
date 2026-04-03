import type { CreditMemoProject, MemoOutline } from "./types";

export type CreditMemoClientDraft = {
  project: CreditMemoProject;
  jobId: string | null;
  outline: MemoOutline | null;
  markdown: string | null;
  memoTitle: string;
  targetWords: number;
  useTemplate: boolean;
  panel: "folder" | "template" | "sources" | "outline" | "memo" | "export";
};

function isPanel(p: unknown): p is CreditMemoClientDraft["panel"] {
  return (
    p === "folder" ||
    p === "template" ||
    p === "sources" ||
    p === "outline" ||
    p === "memo" ||
    p === "export"
  );
}

export function parseCreditMemoDraftJson(raw: string, ticker: string): CreditMemoClientDraft | null {
  try {
    const d = JSON.parse(raw) as Partial<CreditMemoClientDraft>;
    if (!d || typeof d !== "object" || !d.project || typeof d.project !== "object") return null;
    if ((d.project as CreditMemoProject).ticker?.toUpperCase() !== ticker.trim().toUpperCase()) return null;
    return {
      project: d.project as CreditMemoProject,
      jobId: typeof d.jobId === "string" ? d.jobId : null,
      outline: (d.outline as MemoOutline) ?? null,
      markdown: typeof d.markdown === "string" ? d.markdown : null,
      memoTitle: typeof d.memoTitle === "string" ? d.memoTitle : "",
      targetWords: typeof d.targetWords === "number" && Number.isFinite(d.targetWords) ? d.targetWords : 10_000,
      useTemplate: d.useTemplate !== false,
      panel: isPanel(d.panel) ? d.panel : "memo",
    };
  } catch {
    return null;
  }
}

export function serializeCreditMemoDraft(draft: CreditMemoClientDraft): string {
  return JSON.stringify(draft);
}
