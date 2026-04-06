import { buildCanonicalEnvProfile } from "@/lib/env-risk/company-profile-builder";
import { getEnvRiskConfig } from "@/lib/env-risk/config";
import {
  readEnvRiskSnapshot,
  readFacilityOverrides,
  readPreviousSnapshotHash,
  snapshotContentHash,
  writeEnvRiskSnapshot,
  writePreviousSnapshotHash,
} from "@/lib/env-risk/cache";
import { resolveFacilitiesFederal } from "@/lib/env-risk/facility-resolver";
import { diffSnapshots } from "@/lib/env-risk/monitoring";
import { buildInvestorNarrative } from "@/lib/env-risk/narrative";
import {
  buildCrossPeriodNotes,
  extractEnvironmentalFromFilingHtml,
} from "@/lib/env-risk/sec-environmental-extractor";
import { buildHotspots, computeEnvironmentalRiskScores } from "@/lib/env-risk/scorer";
import { StateAgencyStub } from "@/lib/env-risk/providers/state-agency-service";
import { stripHtmlToPlainText, hashText } from "@/lib/env-risk/text-utils";
import type { DisclosureRow, EnvRiskSnapshot, EnvTopic, SourceRef } from "@/lib/env-risk/types";
import { listSavedDocuments } from "@/lib/saved-documents";
import { getCompanyProfile, getFilingsByTicker, type SecFiling } from "@/lib/sec-edgar";
import { getSubsidiaryHintsForTicker } from "@/lib/subsidiary-hints";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

function pickFilings(filings: SecFiling[], maxTotal: number): SecFiling[] {
  const sorted = [...filings].sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  const out: SecFiling[] = [];
  let k = 0,
    q = 0,
    e = 0;
  for (const f of sorted) {
    if (out.length >= maxTotal) break;
    const form = f.form.trim().toUpperCase();
    if (form === "10-K" || form === "10-K/A") {
      if (k >= 3) continue;
      k++;
      out.push(f);
    } else if (form === "10-Q" || form === "10-Q/A") {
      if (q >= 5) continue;
      q++;
      out.push(f);
    } else if (form === "8-K" || form === "8-K/A") {
      if (e >= 6) continue;
      e++;
      out.push(f);
    }
  }
  return out;
}

async function fetchFilingText(url: string, ua: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export type RunEnvRiskPipelineOptions = {
  ticker: string;
  userId?: string | null;
  forceRefresh?: boolean;
  respectCache?: boolean;
};

export type RunEnvRiskPipelineResult =
  | { ok: true; snapshot: EnvRiskSnapshot; from_cache: boolean }
  | { ok: false; error: string };

export async function runEnvRiskPipeline(opts: RunEnvRiskPipelineOptions): Promise<RunEnvRiskPipelineResult> {
  const ticker = sanitizeTicker(opts.ticker);
  if (!ticker) return { ok: false, error: "Invalid ticker" };

  const cfg = getEnvRiskConfig();
  const now = new Date().toISOString();

  if (opts.respectCache !== false && !opts.forceRefresh) {
    const cached = await readEnvRiskSnapshot(ticker);
    if (cached) {
      const age = Date.now() - Date.parse(cached.last_refreshed_iso);
      if (!Number.isNaN(age) && age >= 0 && age < cfg.cacheTtlMs) {
        return { ok: true, snapshot: cached, from_cache: true };
      }
    }
  }

  const errors: string[] = [];
  const pipeline_notes: string[] = [];

  const [filingsResult, secProfile] = await Promise.all([
    getFilingsByTicker(ticker),
    getCompanyProfile(ticker),
  ]);

  if (!filingsResult) errors.push("Could not load SEC filings for ticker.");
  const filings = filingsResult?.filings ?? [];
  const picked = pickFilings(filings, cfg.maxFilingFetches);

  const subsidiaryHints = await getSubsidiaryHintsForTicker(ticker, opts.userId ?? undefined);
  if (!subsidiaryHints.ok) pipeline_notes.push(`Subsidiary hints: ${subsidiaryHints.message}`);

  if (opts.userId) {
    const docs = await listSavedDocuments(opts.userId, ticker);
    if (docs?.length) {
      pipeline_notes.push(
        `Saved documents (filenames only in v1): ${docs
          .slice(0, 12)
          .map((d) => d.filename)
          .join(", ")}${docs.length > 12 ? "…" : ""}`
      );
    }
  } else {
    pipeline_notes.push(
      "Not signed in — saved-documents filenames not merged; SEC + saved subsidiary list (when available) still apply."
    );
  }

  const allDisclosures: DisclosureRow[] = [];
  const filingSummaries: EnvRiskSnapshot["filing_summaries"] = [];
  const tenKMeta: { filing_date: string; topics: Set<EnvTopic>; hash: string; plainSample: string }[] = [];
  const facilityHints: string[] = [];

  for (const f of picked) {
    const html = await fetchFilingText(f.docUrl, cfg.secUserAgent);
    if (!html) {
      errors.push(`Failed to fetch ${f.form} ${f.accessionNumber}`);
      continue;
    }
    const { rows, summary } = extractEnvironmentalFromFilingHtml({
      html,
      form: f.form,
      filing_date: f.filingDate,
      accession_number: f.accessionNumber,
      primary_document: f.primaryDocument,
      doc_url: f.docUrl,
    });
    allDisclosures.push(...rows);
    filingSummaries.push(summary);
    for (const r of rows) if (r.facility_reference) facilityHints.push(r.facility_reference);

    const formU = f.form.trim().toUpperCase();
    if (formU === "10-K" || formU === "10-K/A") {
      const plain = stripHtmlToPlainText(html).slice(0, 80_000);
      tenKMeta.push({
        filing_date: f.filingDate,
        topics: new Set(summary.topics),
        hash: hashText(plain),
        plainSample: plain.slice(0, 4000),
      });
    }
  }

  const profile = buildCanonicalEnvProfile({
    ticker,
    secProfile,
    subsidiaryHints: subsidiaryHints.ok ? subsidiaryHints : null,
    extractedFacilityHints: facilityHints,
  });

  const overrides = await readFacilityOverrides(ticker);
  let facilities = await resolveFacilitiesFederal({ profile, cfg, overrides, errors });
  facilities = facilities.filter((f) => f.registry_id && !overrides.rejected_registry_ids.includes(f.registry_id));

  const stateStub = new StateAgencyStub();
  const states = facilities.map((f) => f.state).filter((s): s is string => Boolean(s));
  const followHints = await stateStub.suggestFollowUps(profile, states);
  const state_follow_up = followHints.map((h) => ({
    state: h.state,
    facility_count: states.filter((s) => s === h.state).length,
    rationale: h.rationale,
    priority: h.priority,
    future_connector: "stateAgencyService v2 — portal-specific scraper/API",
  }));

  if (facilities.length > 5 && allDisclosures.length < 8) {
    pipeline_notes.push(
      "Possible disclosure vs. federal index gap: several FRS/ECHO rows matched but few environmental keyword windows in the sampled filing bodies — verify Item 1A, Legal Proceedings, and footnotes manually."
    );
  }

  const echoErrs = errors.filter((e) => e.toLowerCase().includes("echo")).length;
  const scores = computeEnvironmentalRiskScores({
    disclosures: allDisclosures,
    facilities,
    facilityCount: facilities.length,
    echoQueryErrors: echoErrs,
  });

  const trends: EnvRiskSnapshot["trends"] = {
    filings_with_env_hits_by_year: {},
    facility_count_by_state: {},
    echo_flag_counts: {
      significant_violation: 0,
      formal_action_recent: 0,
      tri_flag: 0,
      air_flag: 0,
    },
  };

  for (const s of filingSummaries) {
    if (s.snippet_count === 0) continue;
    const y = s.filing_date.slice(0, 4);
    trends.filings_with_env_hits_by_year[y] = (trends.filings_with_env_hits_by_year[y] ?? 0) + 1;
  }
  for (const f of facilities) {
    if (f.state) trends.facility_count_by_state[f.state] = (trends.facility_count_by_state[f.state] ?? 0) + 1;
    for (const c of f.compliance_flags) {
      if (/significant|violation/i.test(c)) trends.echo_flag_counts.significant_violation++;
    }
    for (const e of f.enforcement_flags) {
      if (/formal|penalt/i.test(e)) trends.echo_flag_counts.formal_action_recent++;
    }
    for (const e of f.emissions_flags) {
      if (/TRI/i.test(e)) trends.echo_flag_counts.tri_flag++;
      if (/CAA/i.test(e)) trends.echo_flag_counts.air_flag++;
    }
  }

  const cross_period = buildCrossPeriodNotes(tenKMeta);

  const partial: EnvRiskSnapshot = {
    version: 1,
    ticker,
    generated_at_iso: now,
    last_refreshed_iso: now,
    config_flags: {
      echo: cfg.echoEnabled,
      envirofacts: cfg.envirofactsEnabled,
      rcra: cfg.rcraEchoFieldsEnabled,
      state_connectors: cfg.stateConnectorsEnabled,
    },
    profile,
    disclosure_rows: allDisclosures.slice(0, 400),
    filing_summaries: filingSummaries,
    cross_period,
    facilities,
    state_follow_up,
    scores,
    hotspots: [],
    trends,
    narrative: {
      bottom_line: "",
      what_company_discloses: "",
      what_regulatory_data_shows: "",
      where_main_risk_sits: "",
      hidden_liabilities_capex: "",
      facilities_states_to_monitor: "",
      benign_or_low_risk: "",
      open_questions: "",
    },
    sources: [],
    monitoring: {
      new_env_language_in_latest_filing: false,
      new_facility_matches: 0,
      material_score_change: false,
      new_enforcement_flags: 0,
      notes: [],
    },
    errors,
    pipeline_notes,
  };

  partial.hotspots = buildHotspots(partial);
  partial.narrative = buildInvestorNarrative(partial);

  const prev = await readEnvRiskSnapshot(ticker);
  partial.monitoring = diffSnapshots(prev, partial);

  const sources: SourceRef[] = [
    {
      source_type: "sec_filing",
      label: "SEC EDGAR submissions & primary documents",
      url: secProfile
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${secProfile.cik}&type=&dateb=&owner=exclude&count=40`
        : "https://www.sec.gov/edgar/searchedgar/legacy/companysearch.html",
      retrieved_at_iso: now,
    },
    {
      source_type: "echo",
      label: "EPA ECHO REST (get_facilities / get_qid)",
      url: "https://echo.epa.gov/tools/web-services",
      retrieved_at_iso: now,
    },
    {
      source_type: "envirofacts_frs",
      label: "EPA Envirofacts Data Service — frs.FRS_FACILITY_SITE",
      url: "https://www.epa.gov/enviro/envirofacts-data-service-api",
      retrieved_at_iso: now,
    },
    { source_type: "internal_cache", label: "CenturyEgg env-risk disk cache", url: null, retrieved_at_iso: now },
  ];
  partial.sources = sources;

  const prevHash = await readPreviousSnapshotHash(ticker);
  const h = snapshotContentHash(partial);
  if (prevHash && prevHash !== h) {
    partial.pipeline_notes.push(`Snapshot fingerprint changed vs prior run (${prevHash.slice(0, 8)} → ${h.slice(0, 8)}).`);
  }
  await writePreviousSnapshotHash(ticker, h);

  await writeEnvRiskSnapshot(ticker, partial);

  return { ok: true, snapshot: partial, from_cache: false };
}
