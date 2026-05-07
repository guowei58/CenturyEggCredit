import {
  UNKNOWN_JURISDICTION_CODE,
  automationBucketLetter,
  getStateCapability,
  recommendedSearchMethodLabel,
} from "@/lib/ucc/stateCapabilityRegistry";

export type StateAggregationRecord = {
  state: string;
  stateDisplay: string;
  entityCount: number;
  exhibit21Count: number;
  creditDocCount: number;
  sosCount: number;
  addressClusterCount: number;
  userAddedCount: number;
  exactJurisdictionCount: number;
  inferredJurisdictionCount: number;
  unknownJurisdictionCount: number;
  automationBucketKey: string;
  automationBucketLetter: string;
  recommendedSearchMethod: string;
  adapterStatus: string;
  manualRequired: boolean;
  searchProgress: string;
  hits: number;
};

type CandidateLike = {
  state: string;
  workflowEntitySources?: string | null;
  jurisdictionConfidenceKind?: string | null;
  workflowHitCount?: number | null;
  workflowSearchStatus?: string | null;
};

function parseSources(raw: string | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!raw?.trim()) return s;
  for (const p of raw.split(";")) {
    const t = p.trim();
    if (t) s.add(t);
  }
  return s;
}

function bumpSourceCounts(sources: Set<string>, agg: StateAggregationRecord) {
  if ([...sources].some((x) => x.startsWith("exhibit21"))) agg.exhibit21Count++;
  if (sources.has("sos_name_family")) agg.sosCount++;
  if (sources.has("address_cluster")) agg.addressClusterCount++;
  if (sources.has("user_added")) agg.userAddedCount++;
}

/**
 * Groups persisted debtor-search candidates by primary search state for dashboard summaries.
 */
export function computeUccStateAggregation(candidates: CandidateLike[]): StateAggregationRecord[] {
  type Acc = {
    row: StateAggregationRecord;
    statuses: Set<string>;
  };

  const byState = new Map<string, Acc>();

  for (const c of candidates) {
    const st = (c.state ?? "").trim().toUpperCase() || UNKNOWN_JURISDICTION_CODE;
    let slot = byState.get(st);
    if (!slot) {
      slot = {
        statuses: new Set<string>(),
        row: {
          state: st,
          stateDisplay: "",
          entityCount: 0,
          exhibit21Count: 0,
          creditDocCount: 0,
          sosCount: 0,
          addressClusterCount: 0,
          userAddedCount: 0,
          exactJurisdictionCount: 0,
          inferredJurisdictionCount: 0,
          unknownJurisdictionCount: 0,
          automationBucketKey: "",
          automationBucketLetter: "",
          recommendedSearchMethod: "",
          adapterStatus: "",
          manualRequired: false,
          searchProgress: "",
          hits: 0,
        },
      };
      byState.set(st, slot);
    }

    const { row } = slot;
    row.entityCount++;
    row.hits += Number(c.workflowHitCount ?? 0);

    const jc = (c.jurisdictionConfidenceKind ?? "unknown").toLowerCase();
    if (jc === "exact") row.exactJurisdictionCount++;
    else if (jc === "inferred") row.inferredJurisdictionCount++;
    else row.unknownJurisdictionCount++;

    bumpSourceCounts(parseSources(c.workflowEntitySources ?? null), row);

    const ws = (c.workflowSearchStatus ?? "").trim();
    if (ws) slot.statuses.add(ws);
  }

  const out: StateAggregationRecord[] = [];

  for (const { row, statuses } of byState.values()) {
    const capability = getStateCapability(row.state);
    const letter = automationBucketLetter(capability.bucket);
    const manualRequired =
      letter === "C" ||
      letter === "D" ||
      capability.adapter_status === "manual_only" ||
      row.state === UNKNOWN_JURISDICTION_CODE;

    out.push({
      ...row,
      stateDisplay: capability.state_name,
      automationBucketKey: capability.bucket,
      automationBucketLetter: letter,
      recommendedSearchMethod: recommendedSearchMethodLabel(capability),
      adapterStatus: capability.adapter_status,
      manualRequired,
      searchProgress: statuses.size ? [...statuses].sort().join("; ") : "Not Started",
    });
  }

  return out.sort((a, b) => {
    if (a.state === UNKNOWN_JURISDICTION_CODE) return 1;
    if (b.state === UNKNOWN_JURISDICTION_CODE) return -1;
    return b.entityCount - a.entityCount || a.state.localeCompare(b.state);
  });
}
