import type { UserPreferencesData } from "@/lib/user-preferences-types";

import type { CreditMemoProject, MemoOutline } from "./types";
import { stripCorpusFromProject } from "./types";

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

/** Persist draft to user preferences: never store ingested chunks/sources/tables (only shell + UI fields). */
export function serializeCreditMemoDraftForPreferences(draft: CreditMemoClientDraft): string {
  const project = draft.project ? stripCorpusFromProject(draft.project) : draft.project;
  return JSON.stringify({ ...draft, project });
}

/** Latest project from server (full or stripped after a work product). */
export async function fetchCreditMemoProjectClient(projectId: string): Promise<CreditMemoProject | null> {
  const res = await fetch(`/api/credit-memo/project/${encodeURIComponent(projectId)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { project?: CreditMemoProject };
  return j.project ?? null;
}

/** Merge server project (often stripped after a work product) into prefs draft without duplicating corpus in JSON. */
export function patchPreferencesCreditMemoDraftProject(
  prev: UserPreferencesData,
  ticker: string,
  project: CreditMemoProject
): UserPreferencesData {
  const sym = ticker.trim().toUpperCase();
  const raw = prev.creditMemoDrafts?.[sym];
  const d = raw ? parseCreditMemoDraftJson(raw, sym) : null;
  if (!d) return prev;
  return {
    ...prev,
    creditMemoDrafts: {
      ...(prev.creditMemoDrafts ?? {}),
      [sym]: serializeCreditMemoDraftForPreferences({ ...d, project }),
    },
  };
}

/**
 * Merge a freshly ingested project into server-backed credit memo draft prefs without
 * clobbering memo fields. When the project id changes (re-ingest), memo job/outline/markdown
 * are cleared to match CompanyAiCreditMemoTab behavior.
 */
export function mergeCreditMemoDraftAfterIngest(
  raw: string | undefined,
  ticker: string,
  nextProject: CreditMemoProject,
  prevProjectId: string | undefined
): string {
  const tk = ticker.trim().toUpperCase();
  if (nextProject.ticker.trim().toUpperCase() !== tk) {
    throw new Error("mergeCreditMemoDraftAfterIngest: ticker mismatch");
  }
  const prev = raw ? parseCreditMemoDraftJson(raw, tk) : null;
  const projectChanged = Boolean(prevProjectId && prevProjectId !== nextProject.id);
  return serializeCreditMemoDraftForPreferences({
    project: nextProject,
    jobId: projectChanged ? null : (prev?.jobId ?? null),
    outline: projectChanged ? null : (prev?.outline ?? null),
    markdown: projectChanged ? null : (prev?.markdown ?? null),
    memoTitle: prev?.memoTitle ?? "",
    targetWords: prev?.targetWords ?? 10_000,
    useTemplate: prev?.useTemplate !== false,
    panel: prev?.panel ?? "folder",
  });
}
