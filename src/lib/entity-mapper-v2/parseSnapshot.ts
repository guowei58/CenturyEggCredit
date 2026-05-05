import type {
  EntityMapperEvidence,
  EntityMapperV2Snapshot,
  FacilityFamilyMatrix,
  ConsolidatedRoleRow,
  RoleChangeLogEntry,
  MatrixCell,
  MatrixCellSymbol,
} from "@/lib/entity-mapper-v2/types";
import type { Exhibit21UniverseRow } from "@/lib/entity-mapper-v2/types";
import type { DebtInventoryItem } from "@/lib/entity-mapper-v2/types";
import { ENTITY_MAPPER_V2_ROLE_COLUMNS } from "@/lib/entity-mapper-v2/roleColumns";
import {
  buildRegistrantNormalizedSet,
  mergeSubsidiariesNotInExhibit21,
} from "@/lib/entity-mapper-v2/subsidiariesNotInExhibit21";

export function extractFirstJsonObject(raw: string): unknown {
  const t = raw.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)```/im.exec(t);
  const inner = (m ? m[1] : t).trim();
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(inner.slice(start, end + 1));
}

function sym(v: unknown): MatrixCellSymbol {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "yes" || s === "✅") return "yes";
  if (s === "no" || s === "❌") return "no";
  if (s === "question" || s === "?" || s === "ambiguous") return "question";
  return "dash";
}

function cellCoerce(v: unknown): MatrixCell {
  if (!v || typeof v !== "object") return { symbol: "dash", evidence_ids: [] };
  const o = v as Record<string, unknown>;
  const ids = Array.isArray(o.evidence_ids)
    ? (o.evidence_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return { symbol: sym(o.symbol), evidence_ids: ids };
}

function evidenceCoerce(v: unknown, idx: number): EntityMapperEvidence | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `ev-${idx}`;
  return {
    id,
    subsidiary_name: typeof o.subsidiary_name === "string" ? o.subsidiary_name : "",
    normalized_subsidiary_name: typeof o.normalized_subsidiary_name === "string" ? o.normalized_subsidiary_name : "",
    matched_document_entity_name: typeof o.matched_document_entity_name === "string" ? o.matched_document_entity_name : "",
    role: typeof o.role === "string" ? o.role : "",
    role_value: ((): EntityMapperEvidence["role_value"] => {
      const x = typeof o.role_value === "string" ? o.role_value : "";
      if (x === "Yes" || x === "No" || x === "Ambiguous" || x === "Expressly Excluded" || x === "Not Stated") return x;
      return "Not Stated";
    })(),
    facility_family: typeof o.facility_family === "string" ? o.facility_family : "",
    document_name: typeof o.document_name === "string" ? o.document_name : "",
    document_type: typeof o.document_type === "string" ? o.document_type : "",
    document_date: typeof o.document_date === "string" ? o.document_date : "",
    filing_date: typeof o.filing_date === "string" ? o.filing_date : "",
    accession_number: typeof o.accession_number === "string" ? o.accession_number : "",
    exhibit_number: typeof o.exhibit_number === "string" ? o.exhibit_number : "",
    direct_exhibit_url: typeof o.direct_exhibit_url === "string" ? o.direct_exhibit_url : "",
    section_reference: typeof o.section_reference === "string" ? o.section_reference : "",
    source_quote: typeof o.source_quote === "string" ? o.source_quote : "",
    confidence: ((): EntityMapperEvidence["confidence"] => {
      const c = typeof o.confidence === "string" ? o.confidence : "";
      if (c === "High" || c === "Medium" || c === "Low") return c;
      return "Low";
    })(),
    status: ((): EntityMapperEvidence["status"] => {
      const s = typeof o.status === "string" ? o.status : "";
      if (s === "Current" || s === "Historical" || s === "Unclear") return s;
      return "Unclear";
    })(),
    notes: typeof o.notes === "string" ? o.notes : "",
  };
}

export function buildSnapshotFromLlmJson(
  raw: unknown,
  ctx: {
    ticker: string;
    universe: Exhibit21UniverseRow[];
    inventory: DebtInventoryItem[];
    inventoryFamilies: string[];
    generatedAtIso: string;
    /** Public company legal names (profile + client) — excluded from "not in Exhibit 21" (parent is not a subsidiary). */
    registrantNamesForFilter: string[];
  }
): EntityMapperV2Snapshot {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const evidenceRaw = Array.isArray(o.evidence) ? o.evidence : [];
  const evidence: EntityMapperEvidence[] = [];
  evidenceRaw.forEach((e, i) => {
    const c = evidenceCoerce(e, i);
    if (c) evidence.push(c);
  });
  const evMap = new Map(evidence.map((e) => [e.id, e]));

  const sanitizeCell = (cell: MatrixCell): MatrixCell => {
    if (cell.symbol !== "yes") return cell;
    const refs = cell.evidence_ids.map((id) => evMap.get(id)).filter(Boolean) as EntityMapperEvidence[];
    if (refs.length === 0) return { symbol: "question", evidence_ids: cell.evidence_ids };
    const ok = refs.some((r) => r.confidence === "High" || r.confidence === "Medium");
    if (!ok) return { symbol: "question", evidence_ids: cell.evidence_ids };
    return cell;
  };

  const facilityMatrices: FacilityFamilyMatrix[] = [];
  const fmRaw = Array.isArray(o.facility_matrices) ? o.facility_matrices : [];
  for (let fi = 0; fi < fmRaw.length; fi++) {
    const fm = fmRaw[fi];
    if (!fm || typeof fm !== "object") continue;
    const rec = fm as Record<string, unknown>;
    const familyId = typeof rec.family_id === "string" ? rec.family_id : `family-${fi}`;
    const familyLabel = typeof rec.family_label === "string" ? rec.family_label : familyId;
    const roleCols =
      Array.isArray(rec.role_columns) && rec.role_columns.length > 0
        ? (rec.role_columns as unknown[]).filter((x): x is string => typeof x === "string")
        : [...ENTITY_MAPPER_V2_ROLE_COLUMNS];
    const rows: FacilityFamilyMatrix["rows"] = {};
    const rowsRaw = Array.isArray(rec.rows) ? rec.rows : [];
    for (const rr of rowsRaw) {
      if (!rr || typeof rr !== "object") continue;
      const r = rr as Record<string, unknown>;
      const name = typeof r.subsidiary_legal_name === "string" ? r.subsidiary_legal_name.trim() : "";
      if (!name) continue;
      const cellsRaw = r.cells && typeof r.cells === "object" ? (r.cells as Record<string, unknown>) : {};
      const cells: Record<string, MatrixCell> = {};
      let evidenceCount = 0;
      const idSeen = new Set<string>();
      for (const col of roleCols) {
        const cell = sanitizeCell(cellCoerce(cellsRaw[col]));
        cells[col] = cell;
        for (const id of cell.evidence_ids) {
          if (!idSeen.has(id)) {
            idSeen.add(id);
            evidenceCount++;
          }
        }
      }
      rows[name] = {
        subsidiary_legal_name: name,
        normalized_name: typeof r.normalized_name === "string" ? r.normalized_name : "",
        jurisdiction: typeof r.jurisdiction === "string" ? r.jurisdiction : "",
        cells,
        status_summary: typeof r.status_summary === "string" ? r.status_summary : "Unclear",
        source_evidence_count:
          typeof r.source_evidence_count === "number" && Number.isFinite(r.source_evidence_count)
            ? Math.floor(r.source_evidence_count)
            : evidenceCount,
        notes: typeof r.notes === "string" ? r.notes : "",
      };
    }

    for (const u of ctx.universe) {
      const nm = u.exhibit21LegalName.trim();
      if (!nm || rows[nm]) continue;
      const cells: Record<string, MatrixCell> = {};
      for (const col of roleCols) {
        cells[col] = { symbol: "dash", evidence_ids: [] };
      }
      rows[nm] = {
        subsidiary_legal_name: nm,
        normalized_name: u.normalizedLegalName,
        jurisdiction: u.jurisdiction,
        cells,
        status_summary: "Unclear",
        source_evidence_count: 0,
        notes: "No matrix row from model — defaulted to not stated",
      };
    }

    facilityMatrices.push({
      familyId,
      familyLabel,
      roleColumns: roleCols,
      rows,
    });
  }

  if (facilityMatrices.length === 0 && ctx.inventoryFamilies.length > 0) {
    for (let i = 0; i < ctx.inventoryFamilies.length; i++) {
      const fam = ctx.inventoryFamilies[i]!;
      const roleCols = [...ENTITY_MAPPER_V2_ROLE_COLUMNS];
      const rows: FacilityFamilyMatrix["rows"] = {};
      for (const u of ctx.universe) {
        const nm = u.exhibit21LegalName.trim();
        if (!nm) continue;
        const cells: Record<string, MatrixCell> = {};
        for (const col of roleCols) cells[col] = { symbol: "dash", evidence_ids: [] };
        rows[nm] = {
          subsidiary_legal_name: nm,
          normalized_name: u.normalizedLegalName,
          jurisdiction: u.jurisdiction,
          cells,
          status_summary: "Unclear",
          source_evidence_count: 0,
          notes: "",
        };
      }
      facilityMatrices.push({
        familyId: `family-${i}`,
        familyLabel: fam,
        roleColumns: roleCols,
        rows,
      });
    }
  }

  const consolidated: ConsolidatedRoleRow[] = [];
  const consRaw = Array.isArray(o.consolidated) ? o.consolidated : [];
  for (const c of consRaw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    consolidated.push({
      subsidiary_legal_name: typeof r.subsidiary_legal_name === "string" ? r.subsidiary_legal_name : "",
      normalized_name: typeof r.normalized_name === "string" ? r.normalized_name : "",
      has_any_current_financing_role: r.has_any_current_financing_role === true,
      roles_summary: typeof r.roles_summary === "string" ? r.roles_summary : "",
      evidence_ids: Array.isArray(r.evidence_ids)
        ? (r.evidence_ids as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      notes: typeof r.notes === "string" ? r.notes : "",
    });
  }

  const roleChangeLog: RoleChangeLogEntry[] = [];
  const logRaw = Array.isArray(o.role_change_log) ? o.role_change_log : [];
  for (const l of logRaw) {
    if (!l || typeof l !== "object") continue;
    const r = l as Record<string, unknown>;
    roleChangeLog.push({
      date: typeof r.date === "string" ? r.date : "",
      document: typeof r.document === "string" ? r.document : "",
      entity: typeof r.entity === "string" ? r.entity : "",
      change: typeof r.change === "string" ? r.change : "",
      source_quote: typeof r.source_quote === "string" ? r.source_quote : "",
      confidence: typeof r.confidence === "string" ? r.confidence : "",
    });
  }

  const ambiguities = Array.isArray(o.ambiguities)
    ? (o.ambiguities as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const llmNotes = typeof o.llm_notes === "string" ? o.llm_notes : undefined;

  const llmSubsRaw = Array.isArray(o.subsidiaries_not_in_exhibit21) ? o.subsidiaries_not_in_exhibit21 : [];
  const registrantNormalized = buildRegistrantNormalizedSet(ctx.registrantNamesForFilter ?? []);
  const subsidiariesNotInExhibit21 = mergeSubsidiariesNotInExhibit21({
    universe: ctx.universe,
    evidence,
    llmRowsRaw: llmSubsRaw,
    registrantNormalized,
  });

  if (facilityMatrices.length === 0 && ctx.universe.length > 0) {
    const roleCols = [...ENTITY_MAPPER_V2_ROLE_COLUMNS];
    const rows: FacilityFamilyMatrix["rows"] = {};
    for (const u of ctx.universe) {
      const nm = u.exhibit21LegalName.trim();
      if (!nm) continue;
      const cells: Record<string, MatrixCell> = {};
      for (const col of roleCols) cells[col] = { symbol: "dash", evidence_ids: [] };
      rows[nm] = {
        subsidiary_legal_name: nm,
        normalized_name: u.normalizedLegalName,
        jurisdiction: u.jurisdiction,
        cells,
        status_summary: "Unclear",
        source_evidence_count: 0,
        notes: "",
      };
    }
    facilityMatrices.push({
      familyId: "corpus",
      familyLabel: "Financing sources (workspace / Saved Documents — no EDGAR inventory this run)",
      roleColumns: roleCols,
      rows,
    });
  }

  return {
    version: 2,
    ticker: ctx.ticker.trim().toUpperCase(),
    generatedAtIso: ctx.generatedAtIso,
    exhibit21Universe: ctx.universe,
    debtInventory: ctx.inventory,
    inventoryFamilies: ctx.inventoryFamilies,
    evidence,
    facilityMatrices,
    consolidated,
    roleChangeLog,
    ambiguities,
    llmNotes,
    subsidiariesNotInExhibit21,
  };
}

export function finalizeSnapshotMatrices(snapshot: EntityMapperV2Snapshot): EntityMapperV2Snapshot {
  for (const m of snapshot.facilityMatrices) {
    for (const k of Object.keys(m.rows)) {
      const row = m.rows[k];
      if (!row) continue;
      let n = 0;
      const seen = new Set<string>();
      for (const col of Object.keys(row.cells)) {
        for (const id of row.cells[col]!.evidence_ids) {
          if (!seen.has(id)) {
            seen.add(id);
            n++;
          }
        }
      }
      row.source_evidence_count = n;
    }
  }
  return snapshot;
}
