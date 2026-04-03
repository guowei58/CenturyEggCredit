import { getCompanyProfile, getFilingsByTicker, type SecFiling } from "@/lib/sec-edgar";
import type { IrAsset, IrAssetType } from "../types";
import { classifyLink } from "../classify/linkClassifier";
import { hostnameOf, normalizeUrlForMatch, nowIso, stableId } from "../utils";

const IMPORTANT_FORMS = new Set([
  "10-K",
  "10-K/A",
  "10-Q",
  "10-Q/A",
  "8-K",
  "8-K/A",
  "DEF 14A",
  "20-F",
  "6-K",
  "S-4",
  "424B",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
]);

function inferPublishedAt(f: SecFiling): string | null {
  const s = (f.filingDate ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function enrichWithSec(params: {
  irSourceId: string;
  ticker: string;
}): Promise<
  | {
      ok: true;
      companyName: string | null;
      cik: string | null;
      assets: IrAsset[];
    }
  | { ok: false; error: string }
> {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) return { ok: false, error: "ticker is required for SEC enrichment" };

  const [profile, filingsRes] = await Promise.all([
    getCompanyProfile(ticker),
    getFilingsByTicker(ticker),
  ]);

  const companyName = profile?.name ?? filingsRes?.companyName ?? null;
  const cik = profile?.cik ?? filingsRes?.cik ?? null;

  const filings = (filingsRes?.filings ?? []).filter((f) => IMPORTANT_FORMS.has((f.form ?? "").trim().toUpperCase()));
  const now = nowIso();
  const assets: IrAsset[] = [];

  for (const f of filings.slice(0, 60)) {
    const url = f.docUrl;
    const norm = normalizeUrlForMatch(url);
    if (!norm) continue;
    const host = hostnameOf(norm);
    const cls = classifyLink({ url: norm, anchorText: `${f.form} ${f.description}` });
    const assetType: IrAssetType = cls.assetType === "html_page" ? "sec_filing" : cls.assetType;

    assets.push({
      id: stableId([params.irSourceId, "sec", norm]),
      ir_source_id: params.irSourceId,
      ir_page_id: null,
      ir_section_id: null,
      url,
      normalized_url: norm,
      title: `${f.form} — ${f.description || "SEC filing"}`.trim(),
      asset_type: assetType,
      file_extension: cls.extension,
      source_type: "sec_enrichment",
      hostname: host,
      anchor_text: f.form,
      context_text: f.description || null,
      published_at: inferPublishedAt(f),
      is_same_domain: false,
      is_from_sec: true,
      metadata_json: {
        accessionNumber: f.accessionNumber,
        primaryDocument: f.primaryDocument,
        form: f.form,
        filingDate: f.filingDate,
      },
      created_at: now,
      updated_at: now,
    });
  }

  return { ok: true, companyName, cik, assets };
}

