import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const STEP_WORKBOOK_SHEET = "Tax Lien Matrix";
const STEP_COLUMN_KEYS = [
  "Step_1_State_Tax_Collections",
  "Step_2_Statewide_Index_or_Central_Search",
  "Step_3_County_Local_Recorder_Search",
  "Step_4_UCC_Related_Lien_Search_Separate",
];
const STEP_LABELS = [
  "State tax / collections",
  "Statewide index / central search",
  "County / local recorder",
  "UCC / related lien (separate)",
];
const STEP_URL_COLUMNS = [
  "State_Tax_Lien_or_Collections_URL",
  "Statewide_Search_or_Index_URL",
  "County_Clerk_Recorder_Directory_URL",
  "UCC_or_Related_Lien_URL",
];

function taxLienMatrixString(v) {
  if (v == null) return "";
  return String(v).trim();
}

function firstHttpUrl(text) {
  const m = String(text).match(/https?:\/\/[^\s);]+/);
  return m ? m[0].replace(/[,;.]+$/, "").trim() : "";
}

function urlsFromAdditionalField(raw) {
  const s = taxLienMatrixString(raw);
  if (!s) return [];
  const found = s.match(/https?:\/\/[^\s;)]+/g);
  if (!found?.length) return [];
  return [...new Set(found.map((u) => u.replace(/[,;.]+$/, "").trim()).filter(Boolean))];
}

function conciseStepHint(text, maxLen = 200) {
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

function build(r) {
  const supplementalAll = urlsFromAdditionalField(taxLienMatrixString(r.Additional_URLs));
  const steps = [];
  for (let i = 0; i < 4; i++) {
    const rawText = taxLienMatrixString(r[STEP_COLUMN_KEYS[i]]);
    const colKey = STEP_URL_COLUMNS[i];
    let url = taxLienMatrixString(r[colKey]);
    if (!url) url = firstHttpUrl(rawText);
    steps.push({
      step: i + 1,
      label: STEP_LABELS[i],
      hint: rawText ? conciseStepHint(rawText) : "",
      url,
    });
  }
  const primarySet = new Set(steps.map((s) => s.url).filter(Boolean));
  const supplementalUrls = supplementalAll.filter((u) => !primarySet.has(u));
  return {
    steps,
    supplementalUrls,
    stateTaxLienRoute: taxLienMatrixString(r.State_Local_Tax_Lien_Route),
    federalTaxLienRoute: taxLienMatrixString(r.Federal_NFTL_Release_Route),
  };
}

const fp = path.join(root, "data", "taxlien_matrix_steps.xlsx");
const wb = XLSX.readFile(fp);
const ws = wb.Sheets[STEP_WORKBOOK_SHEET] ?? wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
const out = {};
for (const r of rows) {
  const abbr = taxLienMatrixString(r.Abbrev).toUpperCase();
  if (!abbr) continue;
  out[abbr] = build(r);
}

const outPath = path.join(root, "data", "tax_lien_search_steps_50_states.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("Wrote", Object.keys(out).length, "states to", outPath);
