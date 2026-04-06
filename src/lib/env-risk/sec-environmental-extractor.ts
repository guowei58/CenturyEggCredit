import type { CrossPeriodNote, DisclosureRow, EnvTopic, FilingExtractionSummary } from "@/lib/env-risk/types";
import { hashText, stripHtmlToPlainText } from "@/lib/env-risk/text-utils";

const KEYWORD_RULES: { re: RegExp; topic: EnvTopic }[] = [
  { re: /\bCERCLA\b|\bSuperfund\b/gi, topic: "superfund_cercla" },
  { re: /\bRCRA\b|hazardous waste|hazardous substances/gi, topic: "rcra_hazwaste" },
  { re: /\bPFAS\b|per- and polyfluoroalkyl/gi, topic: "pfas" },
  { re: /\basbestos\b/gi, topic: "asbestos" },
  { re: /groundwater|contamination|remediation|environmental liabilit/gi, topic: "environmental_liability" },
  { re: /asset retirement obligation|\bARO\b/gi, topic: "aro" },
  { re: /environmental reserve|remediation accrual|cleanup reserve/gi, topic: "remediation_reserve" },
  { re: /Clean Air Act|\bCAA\b|air permit|Title V/gi, topic: "permitting" },
  { re: /Clean Water Act|\bCWA\b|NPDES|wastewater|effluent/gi, topic: "water_waste" },
  { re: /Scope [123]|GHG|greenhouse gas|climate risk|physical risk|transition risk/gi, topic: "emissions_climate" },
  { re: /environmental capital|environmental capex|pollution control equipment/gi, topic: "capex_environmental" },
  { re: /spill|release to the environment|unpermitted discharge/gi, topic: "spill_release" },
  { re: /legal proceedings.*environment|environmental proceeding|environmental litigation/gi, topic: "legal_environmental" },
  { re: /landfill|leachate|reclamation obligation|mine reclamation/gi, topic: "water_waste" },
];

const AMOUNT_RE = /\$\s?[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|thousand)?|\d+(?:\.\d+)?\s*million(?!\s*shares)/gi;

function classifyTopic(text: string): EnvTopic {
  const t = text.slice(0, 800);
  for (const { re, topic } of KEYWORD_RULES) {
    re.lastIndex = 0;
    if (re.test(t)) return topic;
  }
  return "other";
}

function extractAmountNear(text: string): string | null {
  const windowed = text.slice(0, 400);
  const m = windowed.match(AMOUNT_RE);
  if (!m || m.length === 0) return null;
  return m[0].replace(/\s+/g, " ").trim().slice(0, 80);
}

function facilityHintFromContext(text: string): string | null {
  const m = text.match(
    /([A-Z][A-Za-z0-9\s,&'\-\.]{4,55})\s+(?:facility|plant|refinery|terminal|mill|mine|warehouse)\b/i
  );
  if (m) return m[1].replace(/\s+/g, " ").trim();
  return null;
}

function windowAroundMatches(plain: string, maxSnippets: number): { snippet: string; start: number }[] {
  const hits: { idx: number; len: number }[] = [];
  for (const { re } of KEYWORD_RULES) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(plain)) !== null) {
      hits.push({ idx: m.index, len: m[0].length });
      if (hits.length > 200) break;
    }
  }
  hits.sort((a, b) => a.idx - b.idx);
  const out: { snippet: string; start: number }[] = [];
  const used = new Set<number>();
  for (const h of hits) {
    if (out.length >= maxSnippets) break;
    const bucket = Math.floor(h.idx / 400);
    if (used.has(bucket)) continue;
    used.add(bucket);
    const start = Math.max(0, h.idx - 220);
    const end = Math.min(plain.length, h.idx + 320);
    out.push({ snippet: plain.slice(start, end).trim(), start });
  }
  return out;
}

export function extractEnvironmentalFromFilingHtml(params: {
  html: string;
  form: string;
  filing_date: string;
  accession_number: string;
  primary_document: string;
  doc_url: string;
  max_snippets?: number;
}): { rows: DisclosureRow[]; summary: FilingExtractionSummary } {
  const plain = stripHtmlToPlainText(params.html);
  const maxSnippets = params.max_snippets ?? 18;
  const windows = windowAroundMatches(plain, maxSnippets);
  const rows: DisclosureRow[] = [];
  const topics = new Set<EnvTopic>();

  for (let i = 0; i < windows.length; i++) {
    const { snippet } = windows[i];
    const topic = classifyTopic(snippet);
    topics.add(topic);
    rows.push({
      source_document: params.primary_document,
      filing_date: params.filing_date,
      form: params.form,
      accession_number: params.accession_number,
      section_name: "extracted_window",
      topic,
      extracted_text: snippet,
      extracted_amount: extractAmountNear(snippet),
      facility_reference: facilityHintFromContext(snippet),
      confidence_score: topic === "other" ? 0.35 : 0.62,
      sec_url: params.doc_url,
    });
  }

  const summary: FilingExtractionSummary = {
    accession_number: params.accession_number,
    form: params.form,
    filing_date: params.filing_date,
    primary_document: params.primary_document,
    doc_url: params.doc_url,
    snippet_count: rows.length,
    topics: Array.from(topics),
    content_hash: hashText(plain.slice(0, 120_000)),
  };

  return { rows, summary };
}

export function buildCrossPeriodNotes(
  tenKRows: { filing_date: string; topics: Set<EnvTopic>; hash: string; plainSample: string }[]
): CrossPeriodNote[] {
  const notes: CrossPeriodNote[] = [];
  if (tenKRows.length < 2) return notes;
  const sorted = [...tenKRows].sort((a, b) => b.filing_date.localeCompare(a.filing_date));
  const newest = sorted[0];
  const prior = sorted[1];
  const added: EnvTopic[] = [];
  for (const t of Array.from(newest.topics)) if (!prior.topics.has(t)) added.push(t);
  if (added.length) {
    notes.push({
      kind: "new_language",
      description: `Topics appearing in ${newest.filing_date} 10-K windows that were not in ${prior.filing_date} extraction sample.`,
      filing_dates: [newest.filing_date, prior.filing_date],
      evidence: added.join(", "),
    });
  }
  const removed: EnvTopic[] = [];
  for (const t of Array.from(prior.topics)) if (!newest.topics.has(t)) removed.push(t);
  if (removed.length) {
    notes.push({
      kind: "removed_language",
      description: `Topics present in older 10-K sample but missing from newer window sample (may be sampling artifact).`,
      filing_dates: [newest.filing_date, prior.filing_date],
      evidence: removed.join(", "),
    });
  }
  if (newest.hash !== prior.hash) {
    notes.push({
      kind: "tone",
      description: "Full-text fingerprint of sampled 10-K body changed year-over-year.",
      filing_dates: [newest.filing_date, prior.filing_date],
      evidence: "SHA sample hash differs — review full Item 1A / Legal / footnotes manually for material changes.",
    });
  }
  return notes;
}
