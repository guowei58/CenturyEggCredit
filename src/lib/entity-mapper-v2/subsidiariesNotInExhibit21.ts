import { normalizeLegalName } from "@/lib/entity-mapper-v2/exhibit21Universe";
import type {
  EntityMapperEvidence,
  Exhibit21UniverseRow,
  SubsidiaryNotInExhibit21Row,
} from "@/lib/entity-mapper-v2/types";

function exhibit21NormalizedSet(universe: Exhibit21UniverseRow[]): Set<string> {
  return new Set(universe.map((u) => u.normalizedLegalName.trim()).filter(Boolean));
}

/** Public parent / SEC registrant — Exhibit 21 lists subsidiaries only, not the parent. */
export function buildRegistrantNormalizedSet(names: (string | null | undefined)[]): Set<string> {
  const s = new Set<string>();
  for (const raw of names) {
    const t = raw?.trim();
    if (!t) continue;
    const n = normalizeLegalName(t);
    if (n) s.add(n);
  }
  return s;
}

function optStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function pickOptional(next?: string, prev?: string): string | undefined {
  const a = next?.trim();
  if (a) return a;
  const b = prev?.trim();
  return b || undefined;
}

function coerceLlmRow(v: unknown): Omit<SubsidiaryNotInExhibit21Row, "detection" | "normalized_name"> & {
  normalized_key: string;
} | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const entity_name = typeof o.entity_name === "string" ? o.entity_name.trim() : "";
  if (!entity_name) return null;
  const normalized_key = normalizeLegalName(entity_name);
  const evidence_ids = Array.isArray(o.evidence_ids)
    ? (o.evidence_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    entity_name,
    normalized_key,
    role_or_context: typeof o.role_or_context === "string" ? o.role_or_context : "",
    source_document: typeof o.source_document === "string" ? o.source_document : "",
    filing_date: typeof o.filing_date === "string" ? o.filing_date : "",
    evidence_ids,
    notes: typeof o.notes === "string" ? o.notes : "",
    importance_flag: optStr(o, "importance_flag"),
    likely_role: optStr(o, "likely_role"),
    parent_immediate_owner: optStr(o, "parent_immediate_owner"),
    jurisdiction_hint: optStr(o, "jurisdiction_hint"),
    source_citation_detail: optStr(o, "source_citation_detail"),
  };
}

/**
 * Combine model-listed entities + evidence `matched_document_entity_name` entries that are not on Exhibit 21.
 * Omits the public parent / registrant (same normalized name as company profile) — they are not "missing" from Exhibit 21.
 */
export function mergeSubsidiariesNotInExhibit21(params: {
  universe: Exhibit21UniverseRow[];
  evidence: EntityMapperEvidence[];
  llmRowsRaw: unknown[];
  /** Normalized legal names of the public company / parent (from CIK profile + client hint). */
  registrantNormalized: Set<string>;
}): SubsidiaryNotInExhibit21Row[] {
  const exSet = exhibit21NormalizedSet(params.universe);
  const parentSet = params.registrantNormalized;
  const byNorm = new Map<string, SubsidiaryNotInExhibit21Row>();

  for (const raw of params.llmRowsRaw) {
    const coerced = coerceLlmRow(raw);
    if (!coerced) continue;
    const n = coerced.normalized_key.trim();
    if (!n || exSet.has(n) || parentSet.has(n)) continue;
    const prev = byNorm.get(n);
    const mergedIds = Array.from(new Set([...(prev?.evidence_ids ?? []), ...coerced.evidence_ids]));
    byNorm.set(n, {
      entity_name: coerced.entity_name,
      normalized_name: n,
      role_or_context: coerced.role_or_context,
      source_document: coerced.source_document,
      filing_date: coerced.filing_date,
      evidence_ids: mergedIds,
      notes: coerced.notes || prev?.notes || "",
      detection: "model",
      importance_flag: pickOptional(coerced.importance_flag, prev?.importance_flag),
      likely_role: pickOptional(coerced.likely_role, prev?.likely_role),
      parent_immediate_owner: pickOptional(coerced.parent_immediate_owner, prev?.parent_immediate_owner),
      jurisdiction_hint: pickOptional(coerced.jurisdiction_hint, prev?.jurisdiction_hint),
      source_citation_detail: pickOptional(coerced.source_citation_detail, prev?.source_citation_detail),
    });
  }

  for (const e of params.evidence) {
    const rawName = e.matched_document_entity_name?.trim();
    if (!rawName) continue;
    const n = normalizeLegalName(rawName);
    if (!n || exSet.has(n) || parentSet.has(n)) continue;

    const prev = byNorm.get(n);
    if (prev) {
      const ids = prev.evidence_ids.includes(e.id) ? prev.evidence_ids : [...prev.evidence_ids, e.id];
      byNorm.set(n, { ...prev, evidence_ids: ids });
      continue;
    }

    byNorm.set(n, {
      entity_name: rawName,
      normalized_name: n,
      role_or_context: e.role || "—",
      source_document: e.document_name || "—",
      filing_date: e.filing_date || "",
      evidence_ids: [e.id],
      notes: e.notes ? `From evidence extraction. ${e.notes}` : "From evidence extraction (matched document entity).",
      detection: "evidence_extract",
    });
  }

  return Array.from(byNorm.values()).sort((a, b) => a.entity_name.localeCompare(b.entity_name));
}
