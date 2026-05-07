import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import taxLienCommittedSteps from "../../../data/tax_lien_search_steps_50_states.json";
import taxLienOfficialPortalUrls from "../../../data/tax_lien_official_portal_urls_50_states.json";
import type { TaxLienSearchStep, TaxLienSourceMatrixRow } from "@/lib/taxLien/taxLienMatrixShared";
import { taxLienMatrixString } from "@/lib/taxLien/taxLienMatrixShared";
import { getStateCapability } from "@/lib/ucc/stateCapabilityRegistry";

export type { TaxLienSearchStep, TaxLienSourceMatrixRow } from "@/lib/taxLien/taxLienMatrixShared";

type OfficialPortalTriple = {
  stateTaxLienOrCollectionsUrl?: string;
  statewideSearchUrl?: string;
  countyClerkRecorderDirectoryUrl?: string;
};

/** USPS abbreviation → official portal URLs (merged after each spreadsheet read). */
const OFFICIAL_PORTAL_URLS_BY_ABBREV = taxLienOfficialPortalUrls as Record<string, OfficialPortalTriple>;

/** Changes whenever `tax_lien_search_steps_50_states.json` changes — invalidates server cache. */
const COMMITTED_STEPS_HASH = crypto.createHash("sha256").update(JSON.stringify(taxLienCommittedSteps)).digest("hex").slice(0, 16);

type CommittedStepsPayload = {
  steps: Array<{ step: number; label: string; hint: string; url: string }>;
  supplementalUrls: string[];
  stateTaxLienRoute?: string;
  federalTaxLienRoute?: string;
};

const COMMITTED_STEPS_BY_ABBREV = taxLienCommittedSteps as Record<string, CommittedStepsPayload>;

/** Always-on four-step workflow from committed JSON (does not depend on `cwd` or xlsx on disk). */
function mergeCommittedSearchSteps(by: Record<string, TaxLienSourceMatrixRow>) {
  for (const [abbr, payload] of Object.entries(COMMITTED_STEPS_BY_ABBREV)) {
    const k = abbr.trim().toUpperCase();
    if (!payload?.steps?.length) continue;
    if (!by[k]) {
      const shell = minimalRowFromAbbrev(k);
      if (shell) by[k] = shell;
    }
    const row = by[k];
    if (!row) continue;
    row.searchSteps = payload.steps
      .filter((s) => s.step >= 1 && s.step <= 4)
      .map((s) => ({
        step: s.step as TaxLienSearchStep["step"],
        label: s.label,
        hint: s.hint,
        url: taxLienMatrixString(s.url),
      }));
    if (payload.supplementalUrls?.length)
      row.supplementalUrls = payload.supplementalUrls.map((u) => taxLienMatrixString(u)).filter(Boolean);
    if (payload.stateTaxLienRoute) row.stateTaxLienRoute = taxLienMatrixString(payload.stateTaxLienRoute);
    if (payload.federalTaxLienRoute) row.federalTaxLienRoute = taxLienMatrixString(payload.federalTaxLienRoute);
  }
}

function mergeOfficialPortalTriples(by: Record<string, TaxLienSourceMatrixRow>) {
  for (const [abbr, triple] of Object.entries(OFFICIAL_PORTAL_URLS_BY_ABBREV)) {
    const row = by[abbr];
    if (!triple || !row) continue;
    if (triple.stateTaxLienOrCollectionsUrl !== undefined)
      row.stateTaxLienOrCollectionsUrl = taxLienMatrixString(triple.stateTaxLienOrCollectionsUrl);
    if (triple.statewideSearchUrl !== undefined) row.statewideSearchUrl = taxLienMatrixString(triple.statewideSearchUrl);
    if (triple.countyClerkRecorderDirectoryUrl !== undefined)
      row.countyClerkRecorderDirectoryUrl = taxLienMatrixString(triple.countyClerkRecorderDirectoryUrl);
  }
}

/** Spreadsheet absent or unusable — still ship the three URLs from committed JSON per state. */
function minimalRowFromAbbrev(abbr: string): TaxLienSourceMatrixRow | null {
  const k = abbr.trim().toUpperCase();
  if (!k || !OFFICIAL_PORTAL_URLS_BY_ABBREV[k]) return null;
  const cap = getStateCapability(k);
  return {
    state: cap.state_name,
    abbr: k,
    stateTaxLienRoute: "",
    federalTaxLienRoute: "",
    stateTaxLienOrCollectionsUrl: "",
    statewideSearchUrl: "",
    countyClerkRecorderDirectoryUrl: "",
    uccOrRelatedLienUrl: "",
    automationBucket: "",
    implementationNotes: "",
  };
}

/** Ensure every USPS code in `tax_lien_official_portal_urls_50_states.json` exists, then overwrite the three URLs from JSON. */
function finalizeRegistry(by: Record<string, TaxLienSourceMatrixRow>) {
  for (const abbr of Object.keys(OFFICIAL_PORTAL_URLS_BY_ABBREV)) {
    const k = abbr.trim().toUpperCase();
    if (!by[k]) {
      const shell = minimalRowFromAbbrev(k);
      if (shell) by[k] = shell;
    }
  }
  mergeOfficialPortalTriples(by);
}

const STEP_WORKBOOK_SHEET = "Tax Lien Matrix";

const STEP_COLUMN_KEYS = [
  "Step_1_State_Tax_Collections",
  "Step_2_Statewide_Index_or_Central_Search",
  "Step_3_County_Local_Recorder_Search",
  "Step_4_UCC_Related_Lien_Search_Separate",
] as const;

const STEP_LABELS = [
  "State tax / collections",
  "Statewide index / central search",
  "County / local recorder",
  "UCC / related lien (separate)",
] as const;

const STEP_URL_COLUMNS = [
  "State_Tax_Lien_or_Collections_URL",
  "Statewide_Search_or_Index_URL",
  "County_Clerk_Recorder_Directory_URL",
  "UCC_or_Related_Lien_URL",
] as const;

function firstHttpUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s);]+/);
  return m ? m[0].replace(/[,;.]+$/, "").trim() : "";
}

/** Split additional URLs (semicolon-separated prose lists). */
function urlsFromAdditionalField(raw: string): string[] {
  const s = taxLienMatrixString(raw);
  if (!s) return [];
  const found = s.match(/https?:\/\/[^\s;)]+/g);
  if (!found?.length) return [];
  return [...new Set(found.map((u) => u.replace(/[,;.]+$/, "").trim()).filter(Boolean))];
}

function conciseStepHint(text: string, maxLen = 200): string {
  let t = taxLienMatrixString(text);
  t = t.replace(/\s*\.?\s*Use URL:\s*https?:\/\/\S+\s*$/i, "").trim();
  const stripLead = [
    /^State tax \/ revenue source:\s*/i,
    /^Statewide or central index[^:]*:\s*/i,
    /^County\/local recorder search:\s*/i,
    /^UCC\/related lien search:\s*/i,
    /^Release\/status workflow:\s*/i,
  ];
  for (const re of stripLead) t = t.replace(re, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > maxLen) return `${t.slice(0, maxLen - 1).trim()}…`;
  return t;
}

function buildSearchStepsFromWorkbookRow(r: Record<string, unknown>): {
  steps: TaxLienSearchStep[];
  supplementalUrls: string[];
} {
  const supplementalAll = urlsFromAdditionalField(taxLienMatrixString(r.Additional_URLs));
  const steps: TaxLienSearchStep[] = [];
  for (let i = 0; i < 4; i++) {
    const rawText = taxLienMatrixString(r[STEP_COLUMN_KEYS[i]]);
    const colKey = STEP_URL_COLUMNS[i];
    let url = taxLienMatrixString(r[colKey]);
    if (!url) url = firstHttpUrl(rawText);
    steps.push({
      step: (i + 1) as TaxLienSearchStep["step"],
      label: STEP_LABELS[i],
      hint: rawText ? conciseStepHint(rawText) : "",
      url,
    });
  }
  const primarySet = new Set(steps.map((s) => s.url).filter(Boolean));
  const supplementalUrls = supplementalAll.filter((u) => !primarySet.has(u));
  return { steps, supplementalUrls };
}

function resolveStepsMatrixPath(): string | null {
  const override = process.env.TAX_LIEN_STEPS_MATRIX_PATH?.trim();
  if (override && fs.existsSync(override)) return override;
  const dir = path.join(process.cwd(), "data");
  for (const name of ["taxlien_matrix_steps.xlsx", "taxlien.xlsx"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Overlays four-step workflow + route prose from the steps workbook (`Tax Lien Matrix` sheet). */
function mergeStepsWorkbook(by: Record<string, TaxLienSourceMatrixRow>) {
  const fp = resolveStepsMatrixPath();
  if (!fp) return;
  try {
    const wb = XLSX.readFile(fp);
    const ws = wb.Sheets[STEP_WORKBOOK_SHEET] ?? wb.Sheets[wb.SheetNames[0] ?? ""];
    const rows = ws ? (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]) : [];
    for (const r of rows) {
      const abbr = taxLienMatrixString(r.Abbrev).toUpperCase();
      if (!abbr) continue;
      if (!by[abbr]) {
        const shell = minimalRowFromAbbrev(abbr);
        if (shell) by[abbr] = shell;
      }
      const row = by[abbr];
      if (!row) continue;

      const { steps, supplementalUrls } = buildSearchStepsFromWorkbookRow(r);
      row.searchSteps = steps;
      if (supplementalUrls.length) row.supplementalUrls = supplementalUrls;

      const st = taxLienMatrixString(r.State);
      if (st) row.state = st;

      const u1 = taxLienMatrixString(r.State_Tax_Lien_or_Collections_URL);
      const u2 = taxLienMatrixString(r.Statewide_Search_or_Index_URL);
      const u3 = taxLienMatrixString(r.County_Clerk_Recorder_Directory_URL);
      const u4 = taxLienMatrixString(r.UCC_or_Related_Lien_URL);
      if (u1) row.stateTaxLienOrCollectionsUrl = u1;
      if (u2) row.statewideSearchUrl = u2;
      if (u3) row.countyClerkRecorderDirectoryUrl = u3;
      if (u4) row.uccOrRelatedLienUrl = u4;

      const sr = taxLienMatrixString(r.State_Local_Tax_Lien_Route);
      const fr = taxLienMatrixString(r.Federal_NFTL_Release_Route);
      if (sr) row.stateTaxLienRoute = sr;
      if (fr) row.federalTaxLienRoute = fr;
    }
  } catch (e) {
    console.error("[taxLienSourceMatrix] steps workbook read failed:", fp, e);
  }
}

let cachedRegistry: Record<string, TaxLienSourceMatrixRow> | null = null;
/** Matrix path + steps workbook path — both participate in cache identity. */
let cachedFingerprint: string | null = null;

function resolveMatrixFilePath(): string | null {
  const override = process.env.TAX_LIEN_MATRIX_PATH?.trim();
  if (override && fs.existsSync(override)) return override;

  const dir = path.join(process.cwd(), "data");
  const preferred = ["tax_lien_source_matrix_50_states.xls", "tax_lien_source_matrix_50_states.xlsx"];
  for (const name of preferred) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadRegistry(): Record<string, TaxLienSourceMatrixRow> {
  const fp = resolveMatrixFilePath();
  const stepsFp = resolveStepsMatrixPath();
  const fingerprint = `${fp ?? "__NO_TAX_LIEN_XLSX__"}|${stepsFp ?? "__NO_STEPS__"}|${COMMITTED_STEPS_HASH}`;

  if (cachedRegistry !== null && cachedFingerprint === fingerprint) return cachedRegistry;

  const by: Record<string, TaxLienSourceMatrixRow> = {};

  if (fp) {
    try {
      const wb = XLSX.readFile(fp);
      const ws = wb.Sheets["50_State_Matrix"] ?? wb.Sheets[wb.SheetNames[0] ?? ""];
      const rows = ws ? (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]) : [];

      for (const r of rows) {
        const abbr = taxLienMatrixString(r.Abbrev).toUpperCase();
        if (!abbr) continue;
        by[abbr] = {
          state: taxLienMatrixString(r.State),
          abbr,
          stateTaxLienRoute: taxLienMatrixString(r.State_Tax_Lien_Route),
          federalTaxLienRoute: taxLienMatrixString(r.Federal_Tax_Lien_Route),
          stateTaxLienOrCollectionsUrl: taxLienMatrixString(r.State_Tax_Lien_or_Collections_URL),
          statewideSearchUrl: taxLienMatrixString(r.Statewide_Search_URL),
          countyClerkRecorderDirectoryUrl: taxLienMatrixString(r.County_Clerk_Recorder_Directory_URL),
          uccOrRelatedLienUrl: taxLienMatrixString(r.UCC_or_Related_Lien_URL),
          automationBucket: taxLienMatrixString(r.Automation_Bucket),
          implementationNotes: taxLienMatrixString(r.Implementation_Notes),
        };
      }
    } catch (e) {
      console.error("[taxLienSourceMatrix] read/parse failed:", fp, e);
      finalizeRegistry(by);
      mergeCommittedSearchSteps(by);
      mergeStepsWorkbook(by);
      cachedRegistry = by;
      cachedFingerprint = fingerprint;
      return by;
    }
  }

  finalizeRegistry(by);
  mergeCommittedSearchSteps(by);
  mergeStepsWorkbook(by);
  cachedRegistry = by;
  cachedFingerprint = fingerprint;
  return by;
}

export function getTaxLienMatrixRow(stateAbbr: string | null | undefined): TaxLienSourceMatrixRow | null {
  const k = String(stateAbbr ?? "").trim().toUpperCase();
  if (!k) return null;
  return loadRegistry()[k] ?? null;
}

/** Subset of matrix rows for the given state abbreviations (empty `states` → empty array). */
export function getTaxLienMatrixRowsForAbbreviations(states: string[]): TaxLienSourceMatrixRow[] {
  const by = loadRegistry();
  const uniq = Array.from(new Set((states ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean)));
  const out = uniq.map((s) => by[s]).filter((x): x is TaxLienSourceMatrixRow => Boolean(x));
  return out.sort((a, b) => a.abbr.localeCompare(b.abbr));
}

/** Full matrix for bootstrap / lookups — modest payload (~50 rows) and avoids footprint vs UI drift. */
export function getAllTaxLienMatrixRows(): TaxLienSourceMatrixRow[] {
  const by = loadRegistry();
  return Object.values(by).sort((a, b) => a.abbr.localeCompare(b.abbr));
}
