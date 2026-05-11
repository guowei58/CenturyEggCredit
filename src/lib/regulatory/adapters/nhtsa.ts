import * as XLSX from "xlsx";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type {
  RegulatoryAgencyAdapter,
  RegulatorySearchParams,
  RegulatorySearchResult,
} from "@/lib/regulatory/types";

function rid() {
  return `nhtsa_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const PUBLIC_RECALLS_CSV =
  "https://data.transportation.gov/api/views/6axg-epim/rows.csv?accessType=DOWNLOAD";

type NhtsaCsvRow = {
  "Report Received Date"?: string;
  "NHTSA ID"?: string;
  "Recall Link"?: string;
  Manufacturer?: string;
  Subject?: string;
  Component?: string;
  "Mfr Campaign Number"?: string;
  "Recall Type"?: string;
  "Potentially Affected"?: string;
  "Recall Description"?: string;
  "Consequence Summary"?: string;
  "Corrective Action"?: string;
  "Park Outside Advisory "?: string;
  "Do Not Drive Advisory"?: string;
  "Completion Rate % (Blank - Not Reported)"?: string;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function manufacturerMatches(query: string, manufacturer: string): boolean {
  const q = normalize(query);
  const m = normalize(manufacturer);
  if (!q || !m) return false;
  if (m.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  return tokens.length > 0 && tokens.every((token) => m.includes(token));
}

function extractRecallUrl(raw: string | undefined, nhtsaId: string): string {
  const text = String(raw ?? "").trim();
  const match = text.match(/\((https?:\/\/[^)]+)\)/i);
  if (match?.[1]) return match[1];
  return nhtsaId ? `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(nhtsaId)}` : "https://www.nhtsa.gov/recalls";
}

export const nhtsaAdapter: RegulatoryAgencyAdapter = {
  sourceId: "nhtsa",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Using NHTSA's public DOT recall dataset export." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const res = await fetch(PUBLIC_RECALLS_CSV, { cache: "no-store", headers: { Accept: "text/csv,*/*" } });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `NHTSA public recall download failed (HTTP ${res.status}).`,
        requestUrl: PUBLIC_RECALLS_CSV,
        raw,
      };
    }

    const workbook = XLSX.read(raw, { type: "string", raw: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    const rows = sheet ? (XLSX.utils.sheet_to_json(sheet, { defval: "" }) as NhtsaCsvRow[]) : [];
    const matchedRows = rows
      .filter((row) => manufacturerMatches(q, String(row.Manufacturer ?? "")))
      .sort((a, b) => String(b["Report Received Date"] ?? "").localeCompare(String(a["Report Received Date"] ?? "")))
      .slice(0, 25);
    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = matchedRows.map((row) => {
      const recallNo = String(row["NHTSA ID"] ?? "").trim();
      const manufacturer = String(row.Manufacturer ?? "").trim() || q;
      const subject = String(row.Subject ?? "").trim();
      const component = String(row.Component ?? "").trim();
      const recallType = String(row["Recall Type"] ?? "").trim();
      const summary = String(row["Recall Description"] ?? "").trim();
      const consequence = String(row["Consequence Summary"] ?? "").trim();
      const remedy = String(row["Corrective Action"] ?? "").trim();
      const reportDate = String(row["Report Received Date"] ?? "").trim();
      const detail = extractRecallUrl(row["Recall Link"], recallNo);
      const confidence = matchConfidenceFromQuery(q, [manufacturer]);

      return {
        result_id: rid(),
        source_id: "nhtsa",
        source_name: "NHTSA",
        agency: "NHTSA",
        category: "Auto / Vehicle Safety / Recalls / Complaints",
        query_used: q,
        matched_entity: manufacturer,
        matched_entity_confidence: confidence,
        title: subject || `Recall ${recallNo || ""}`.trim(),
        record_type: "recall",
        record_subtype: [recallType, component].filter(Boolean).join(" · ") || undefined,
        description: summary || undefined,
        filing_or_record_date: reportDate || undefined,
        status:
          String(row["Do Not Drive Advisory"] ?? "").trim() === "Yes"
            ? "Do Not Drive"
            : String(row["Park Outside Advisory "] ?? "").trim() === "Yes"
              ? "Park Outside"
              : undefined,
        agency_identifier: recallNo || undefined,
        document_url: detail,
        detail_url: detail,
        raw_source_url: detail,
        source_quote: [consequence ? `Consequence: ${consequence}` : "", remedy ? `Remedy: ${remedy}` : ""].filter(Boolean).join(" · ") || undefined,
        raw_json: row,
        confidence,
        importance_score: confidence === "High" ? 75 : confidence === "Medium" ? 50 : 20,
        retrieved_at: retrievedAt,
        request_url: PUBLIC_RECALLS_CSV,
        notes: [
          row["Mfr Campaign Number"] ? `Mfr campaign ${String(row["Mfr Campaign Number"]).trim()}` : "",
          row["Potentially Affected"] ? `Potentially affected ${String(row["Potentially Affected"]).trim()}` : "",
        ].filter(Boolean).join(" · ") || undefined,
      };
    });

    return {
      ok: true,
      requestUrl: PUBLIC_RECALLS_CSV,
      raw: { csvRows: rows.length, matchedRows: matchedRows.length },
      results,
      warnings:
        results.length === 0
          ? ["No manufacturer matches were found in NHTSA's public recalls-by-manufacturer dataset for this query."]
          : undefined,
    };
  },
};
