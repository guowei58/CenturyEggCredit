import type { EntitySearchTaskReason } from "@/generated/prisma/client";
import { getEntitySourceRowsForStates, type EntityRegistrySourceRow } from "@/lib/entitySourceRegistry";
import { normalizeAddress, normalizeEntityName } from "@/lib/entityNormalize";

export type EntityIntelProfileInput = {
  ticker: string;
  companyName?: string | null;
  publicRegistrantName?: string | null;
  stateOfIncorporation?: string | null;
  hqState?: string | null;
  hqCity?: string | null;
  /** Full HQ line when available */
  hqAddress?: string | null;
  principalExecutiveOfficeAddress?: string | null;
  majorOperatingStates?: string[];
  majorFacilityAddresses?: string[];
  subsidiaryNames?: string[];
  subsidiaryDomiciles?: string[];
  borrowerNames?: string[];
  guarantorNames?: string[];
  issuerNames?: string[];
  dbaNames?: string[];
  formerNames?: string[];
  restrictedSubsidiaryNames?: string[];
  unrestrictedSubsidiaryNames?: string[];
  excludedSubsHint?: string[]; // excluded_subsidiary from credit docs via restricted names buckets — optional
};

const FINANCE_KEYWORDS = [
  "FUNDING",
  "FINANCE",
  "RECEIVABLES",
  "CAPITAL",
  "LEASING",
  "TRUST",
  "ABS",
  "SPE",
  "SPV",
  "ASSET HOLDINGS",
  "INTERMEDIATE HOLDINGS",
  "IP HOLDINGS",
  "REAL ESTATE HOLDINGS",
  "MANAGEMENT",
  "SERVICES",
] as const;

function usStateGuess(s?: string | null): string | null {
  const t = (s ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(t)) return t;
  const m = t.match(/\b([A-Z]{2})\s*$/);
  return m ? m[1]! : null;
}

export function inferStatesFromAddressLine(line?: string | null): string[] {
  if (!line?.trim()) return [];
  const n = normalizeAddress(line).normalized;
  const m = n.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b$/);
  if (m?.[1]) return [m[1]];
  return [];
}

/** Collect prioritized US-ish state codes from profile geography. */
function baseStateUniverse(inp: EntityIntelProfileInput): string[] {
  const seen: string[] = [];
  const add = (s?: string | null) => {
    const c = usStateGuess(s);
    if (c && !seen.includes(c)) seen.push(c);
  };

  add(inp.stateOfIncorporation);
  add(inp.hqState);
  inferStatesFromAddressLine(inp.hqAddress).forEach((x) => add(x));
  inferStatesFromAddressLine(inp.principalExecutiveOfficeAddress).forEach((x) => add(x));
  for (const m of inp.majorOperatingStates ?? []) add(m);

  const fac = inp.majorFacilityAddresses ?? [];
  for (const f of fac) inferStatesFromAddressLine(f).forEach((x) => add(x));

  if (
    inp.subsidiaryNames?.some((n) => /\bHOLDINGS?\b|\bSPV\b|\bSPE\b|\bTRUST\b|\bFINANCE\b/i.test(n)) &&
    !seen.includes("DE")
  ) {
    seen.push("DE");
  }

  return seen;
}

/** Name variants per spec (conservative bounded list). */
function nameVariants(raw: string, includeFinanceKeywordHypos: boolean): string[] {
  const { original, normalized, root } = normalizeEntityName(raw);
  if (!original.trim()) return [];
  const set = new Set<string>();
  set.add(original);
  set.add(normalized);
  if (root && root !== normalized) set.add(root);

  const letters = normalized.replace(/[^A-Z]/g, "");
  if (letters.length >= 3 && letters.length <= 8) set.add(letters);

  const parts = normalized.split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length > 2) set.add(parts.slice(0, 2).join(" "));

  if (includeFinanceKeywordHypos) {
    for (const kw of FINANCE_KEYWORDS) {
      if (normalized.includes(kw.replace(/\s+/g, " "))) continue;
      set.add(`${root} ${kw}`.replace(/\s+/g, " ").trim());
      if (set.size > 24) break;
    }
  }

  return Array.from(set)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function statesForSubsidiary(domicile: string | undefined, universe: string[]): string[] {
  const d = domicile?.trim() ?? "";
  const j = usStateGuess(d.startsWith(",") ? d.slice(1) : d) ?? usStateGuess(d);
  const out = new Set<string>();
  if (j) out.add(j);
  for (const s of universe) out.add(s);
  if (!j && !universe.length) out.add("DE");
  else if (!j && !out.has("DE")) out.add("DE");
  return Array.from(out).slice(0, 14);
}

function taskReasonForRole(kind: string): EntitySearchTaskReason {
  switch (kind) {
    case "borrower":
      return "borrower";
    case "guarantor":
      return "guarantor";
    case "issuer":
      return "issuer";
    case "dba":
      return "dba";
    case "former_name":
      return "former_name";
    case "subsidiary":
      return "exhibit_21_entity";
    default:
      return "credit_party";
  }
}

export type GeneratedSearchTaskDraft = {
  entityName: string;
  normalizedEntityName: string;
  state: string;
  sourceName: string;
  sourceUrl: string;
  searchReason: EntitySearchTaskReason;
};

function expandTasks(
  variants: string[],
  states: string[],
  rows: EntityRegistrySourceRow[],
  reason: EntitySearchTaskReason,
): GeneratedSearchTaskDraft[] {
  const out: GeneratedSearchTaskDraft[] = [];
  const seen = new Set<string>();
  for (const name of variants) {
    const { normalized } = normalizeEntityName(name);
    if (!normalized) continue;
    for (const st of states) {
      for (const row of rows) {
        const key = `${normalized}|${st}|${row.sourceUrl}|${reason}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          entityName: name,
          normalizedEntityName: normalized,
          state: st,
          sourceName: row.sourceName,
          sourceUrl: row.sourceUrl,
          searchReason: reason,
        });
      }
    }
  }
  return out;
}

/**
 * Produce draft search tasks linking official portals only (no scraping).
 */
export function generateEntitySearchTasks(
  inp: EntityIntelProfileInput,
  opts?: {
    /** Extra SOS rows merged from user profile.customSourceRegistryEntries */
    customSources?: EntityRegistrySourceRow[];
  },
): GeneratedSearchTaskDraft[] {
  const universe = baseStateUniverse(inp);
  const parentNames = [inp.companyName, inp.publicRegistrantName].filter(Boolean) as string[];

  let all: GeneratedSearchTaskDraft[] = [];

  /** Parent registrant searches */
  for (const pname of parentNames) {
    const variants = nameVariants(pname!, true);
    const rows = getEntitySourceRowsForStates(universe.length ? universe : ["DE"], opts?.customSources ?? []);
    if (!rows.length) continue;
    all = all.concat(expandTasks(variants, universe.length ? universe : ["DE"], rows, "credit_party"));
  }

  /** State-of-incorp / HQ explicit quick paths */
  const inc = usStateGuess(inp.stateOfIncorporation);
  if (inc) {
    const rows = getEntitySourceRowsForStates([inc], opts?.customSources ?? []);
    for (const pname of parentNames.slice(0, 1)) {
      const variants = nameVariants(pname!, false);
      all = all.concat(expandTasks(variants, [inc], rows, "state_of_incorporation"));
    }
  }
  const hq = usStateGuess(inp.hqState);
  if (hq && parentNames.length) {
    const rows = getEntitySourceRowsForStates([hq], opts?.customSources ?? []);
    const variants = nameVariants(parentNames[0]!, false);
    all = all.concat(expandTasks(variants, [hq], rows, "hq_state"));
  }

  /** Subsidiaries (Exhibit 21 style list) */
  const subs = inp.subsidiaryNames ?? [];
  const doms = inp.subsidiaryDomiciles ?? [];
  for (let i = 0; i < subs.length; i++) {
    const nm = subs[i]!;
    const stUniverse = statesForSubsidiary(doms[i], universe);
    const rows = getEntitySourceRowsForStates(stUniverse, opts?.customSources ?? []);
    if (!rows.length) continue;
    const variants = nameVariants(nm, true);
    all = all.concat(expandTasks(variants, stUniverse, rows, "exhibit_21_entity"));
  }

  /** Credit parties */
  const bag: { name: string; role: "borrower" | "guarantor" | "issuer" }[] = [];
  for (const n of inp.borrowerNames ?? []) bag.push({ name: n, role: "borrower" });
  for (const n of inp.guarantorNames ?? []) bag.push({ name: n, role: "guarantor" });
  for (const n of inp.issuerNames ?? []) bag.push({ name: n, role: "issuer" });
  for (const entry of bag) {
    const stUniverse = universe.length ? universe : ["DE"];
    const rows = getEntitySourceRowsForStates(stUniverse, opts?.customSources ?? []);
    const variants = nameVariants(entry.name, true);
    all = all.concat(expandTasks(variants, stUniverse, rows, taskReasonForRole(entry.role)));
  }

  /** DBAs / former names */
  for (const n of inp.dbaNames ?? []) {
    const stUniverse = universe.length ? universe : ["DE"];
    const rows = getEntitySourceRowsForStates(stUniverse, opts?.customSources ?? []);
    all = all.concat(expandTasks(nameVariants(n, false), stUniverse, rows, "dba"));
  }
  for (const n of inp.formerNames ?? []) {
    const stUniverse = universe.length ? universe : ["DE"];
    const rows = getEntitySourceRowsForStates(stUniverse, opts?.customSources ?? []);
    all = all.concat(expandTasks(nameVariants(n, false), stUniverse, rows, "former_name"));
  }

  /** Address-cluster seed (state inferred only; user runs manual SOS address search offline) */
  const addrClusters: string[] = [];
  const pushAddr = (a?: string | null) => {
    if (!a?.trim()) return;
    addrClusters.push(a);
  };
  pushAddr(inp.hqAddress);
  pushAddr(inp.principalExecutiveOfficeAddress);
  for (const f of inp.majorFacilityAddresses ?? []) pushAddr(f);
  const addrStates = new Set<string>();
  for (const a of addrClusters) inferStatesFromAddressLine(a).forEach((s) => addrStates.add(s));

  const rowsAddr = getEntitySourceRowsForStates(Array.from(addrStates), opts?.customSources ?? []);
  for (const pname of parentNames.slice(0, 1)) {
    if (!rowsAddr.length || !addrStates.size) continue;
    all = all.concat(
      expandTasks(nameVariants(pname!, false), Array.from(addrStates), rowsAddr, "address_cluster"),
    );
  }

  /** Dedupe */
  const k = new Set<string>();
  return all.filter((t) => {
    const key = `${t.normalizedEntityName}|${t.state}|${t.sourceUrl}|${t.searchReason}`;
    if (k.has(key)) return false;
    k.add(key);
    return true;
  });
}
