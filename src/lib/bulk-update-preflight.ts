import type { BulkOpenContext, BulkUpdateStep } from "@/lib/bulk-ai-open";

export type BulkUpdateMode = "missing-only" | "overwrite-all";

export type BulkStepPhase = "sources" | "work-product";

export type BulkStepPreflight = {
  index: number;
  label: string;
  complete: boolean;
  phase: BulkStepPhase;
};

export type BulkUpdatePreflightResult = {
  steps: BulkStepPreflight[];
  /** Information-gathering steps (research, credit docs, Excel, entity mapper, earnings package). */
  sourcesCompleteCount: number;
  sourcesMissingCount: number;
  sourcesTotal: number;
  /** Work-product steps (KPI, Forensic, LME, memo, etc.) — refreshed after sources when requested. */
  workProductCount: number;
  workProductCompleteCount: number;
  /** @deprecated Use sourcesCompleteCount + workProductCompleteCount */
  completeCount: number;
  /** @deprecated Use sourcesMissingCount */
  missingCount: number;
  total: number;
};

export type BulkUpdateConfirmChoice = {
  mode: BulkUpdateMode;
  /** When mode is missing-only: run all work-product steps even if they already have saved output. */
  refreshWorkProducts: boolean;
};

export type BulkUpdateRunOptions = {
  mode?: BulkUpdateMode;
  preflight?: BulkStepPreflight[];
  refreshWorkProducts?: boolean;
};

/** JSON shape returned by GET /api/bulk-update-preflight/[ticker] */
export type BulkPreflightSnapshotJson = {
  nonEmptySaveKeys: string[];
  hasCapitalStructureExcel: boolean;
  hasOrgChartExcel: boolean;
  earningsPackageComplete: boolean;
  entityMapperComplete: boolean;
};

/** Inputs for assessing whether each bulk pipeline step already has a saved deliverable. */
export type BulkPreflightSnapshot = {
  nonEmptySaveKeys: Set<string>;
  hasCapitalStructureExcel: boolean;
  hasOrgChartExcel: boolean;
  earningsPackageComplete: boolean;
  entityMapperComplete: boolean;
};

export function bulkPreflightSnapshotFromJson(json: BulkPreflightSnapshotJson): BulkPreflightSnapshot {
  return {
    nonEmptySaveKeys: new Set(json.nonEmptySaveKeys ?? []),
    hasCapitalStructureExcel: json.hasCapitalStructureExcel === true,
    hasOrgChartExcel: json.hasOrgChartExcel === true,
    earningsPackageComplete: json.earningsPackageComplete === true,
    entityMapperComplete: json.entityMapperComplete === true,
  };
}

export function isBulkWorkProductStep(step: BulkUpdateStep): boolean {
  return step.type === "work-product" || step.type === "ai-memo";
}

export function bulkStepPhase(step: BulkUpdateStep): BulkStepPhase {
  return isBulkWorkProductStep(step) ? "work-product" : "sources";
}

export function assessBulkStepComplete(step: BulkUpdateStep, snap: BulkPreflightSnapshot): boolean {
  switch (step.type) {
    case "prompt":
    case "work-product":
    case "ai-memo":
    case "credit-doc-analyze":
      return snap.nonEmptySaveKeys.has(step.saveKey);
    case "excel-prompt":
      return step.target === "capital-structure" ? snap.hasCapitalStructureExcel : snap.hasOrgChartExcel;
    case "entity-mapper":
      return snap.entityMapperComplete;
    case "earnings-package":
      return snap.earningsPackageComplete;
    default:
      return false;
  }
}

export function assessBulkUpdatePreflight(
  steps: BulkUpdateStep[],
  snap: BulkPreflightSnapshot
): BulkUpdatePreflightResult {
  const stepsOut = steps.map((step, index) => ({
    index,
    label: step.label,
    complete: assessBulkStepComplete(step, snap),
    phase: bulkStepPhase(step),
  }));
  const sourceSteps = stepsOut.filter((s) => s.phase === "sources");
  const workSteps = stepsOut.filter((s) => s.phase === "work-product");
  const sourcesCompleteCount = sourceSteps.filter((s) => s.complete).length;
  const workProductCompleteCount = workSteps.filter((s) => s.complete).length;
  const completeCount = stepsOut.filter((s) => s.complete).length;
  return {
    steps: stepsOut,
    sourcesCompleteCount,
    sourcesMissingCount: sourceSteps.length - sourcesCompleteCount,
    sourcesTotal: sourceSteps.length,
    workProductCount: workSteps.length,
    workProductCompleteCount,
    completeCount,
    missingCount: stepsOut.length - completeCount,
    total: stepsOut.length,
  };
}

/** True when this step would be skipped for the chosen bulk run options. */
export function shouldSkipBulkStep(
  step: BulkUpdateStep,
  pf: BulkStepPreflight | undefined,
  mode: BulkUpdateMode,
  refreshWorkProducts: boolean
): boolean {
  if (mode === "overwrite-all") return false;
  if (isBulkWorkProductStep(step)) {
    return !refreshWorkProducts;
  }
  return pf?.complete === true;
}

export function countBulkStepsToRun(
  steps: BulkUpdateStep[],
  preflight: BulkStepPreflight[],
  mode: BulkUpdateMode,
  refreshWorkProducts: boolean
): number {
  if (mode === "overwrite-all") return steps.length;
  return steps.filter((step, i) => !shouldSkipBulkStep(step, preflight[i], mode, refreshWorkProducts)).length;
}

export function countMissingOnlyRunSteps(
  preflight: BulkUpdatePreflightResult,
  refreshWorkProducts: boolean
): number {
  return preflight.sourcesMissingCount + (refreshWorkProducts ? preflight.workProductCount : 0);
}

export async function fetchBulkUpdatePreflight(ctx: BulkOpenContext): Promise<BulkUpdatePreflightResult> {
  const sym = ctx.ticker.trim();
  if (!sym) {
    return {
      steps: [],
      sourcesCompleteCount: 0,
      sourcesMissingCount: 0,
      sourcesTotal: 0,
      workProductCount: 0,
      workProductCompleteCount: 0,
      completeCount: 0,
      missingCount: 0,
      total: 0,
    };
  }
  const res = await fetch(`/api/bulk-update-preflight/${encodeURIComponent(sym)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as BulkPreflightSnapshotJson & { error?: string };
  if (!res.ok) {
    throw new Error(body.error?.trim() || `Could not check saved tab status (${res.status})`);
  }

  const { collectBulkUpdateSteps } = await import("@/lib/bulk-ai-open");
  const steps = collectBulkUpdateSteps(ctx);
  const snap = bulkPreflightSnapshotFromJson(body);
  return assessBulkUpdatePreflight(steps, snap);
}
