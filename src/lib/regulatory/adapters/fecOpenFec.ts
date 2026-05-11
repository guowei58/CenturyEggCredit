import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

function rid() {
  return `fec_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function fecKey(): string | undefined {
  return process.env.FEC_API_KEY?.trim();
}

export const fecOpenFecAdapter: RegulatoryAgencyAdapter = {
  sourceId: "fec",
  validateConfig: () => {
    const k = fecKey();
    if (!k) {
      return {
        ok: false,
        mode: "missing_key",
        message: "FEC OpenFEC requires FEC_API_KEY (see api.open.fec.gov).",
        envKeyName: "FEC_API_KEY",
      };
    }
    return { ok: true, mode: "api_key" };
  },
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const key = fecKey();
    if (!key) {
      return {
        ok: false,
        error: "FEC_API_KEY is not set.",
        hint: "Sign up at api.open.fec.gov and add FEC_API_KEY to .env.local.",
      };
    }

    const committeeUrl = new URL("https://api.open.fec.gov/v1/committees/");
    committeeUrl.searchParams.set("api_key", key);
    committeeUrl.searchParams.set("q", q);
    committeeUrl.searchParams.set("per_page", "15");
    committeeUrl.searchParams.set("sort", "name");

    const candidateUrl = new URL("https://api.open.fec.gov/v1/candidates/search/");
    candidateUrl.searchParams.set("api_key", key);
    candidateUrl.searchParams.set("name", q);
    candidateUrl.searchParams.set("per_page", "10");
    candidateUrl.searchParams.set("sort", "name");

    const [committeeRes, candidateRes] = await Promise.all([
      fetch(committeeUrl.toString(), { cache: "no-store" }),
      fetch(candidateUrl.toString(), { cache: "no-store" }),
    ]);
    const [committeeRaw, candidateRaw] = await Promise.all([
      committeeRes.json().catch(() => null),
      candidateRes.json().catch(() => null),
    ]);
    if (!committeeRes.ok && !candidateRes.ok) {
      return {
        ok: false,
        error: `OpenFEC request failed (HTTP ${committeeRes.status}).`,
        requestUrl: committeeUrl.toString().replace(/api_key=[^&]+/, "api_key=(redacted)"),
        raw: { committeeRaw, candidateRaw },
      };
    }

    const committeeRows = (committeeRaw as { results?: Array<Record<string, unknown>> })?.results ?? [];
    const candidateRows = (candidateRaw as { results?: Array<Record<string, unknown>> })?.results ?? [];
    const topCommitteeIds = committeeRows
      .slice(0, 5)
      .map((row) => String(row?.committee_id ?? "").trim())
      .filter(Boolean);
    const committeeDisbursementResponses = await Promise.all(
      topCommitteeIds.map(async (committeeId) => {
        const url = new URL(`https://api.open.fec.gov/v1/committee/${encodeURIComponent(committeeId)}/schedules/schedule_b/by_recipient/`);
        url.searchParams.set("api_key", key);
        url.searchParams.set("per_page", "5");
        const res = await fetch(url.toString(), { cache: "no-store" });
        const raw = await res.json().catch(() => null);
        return { committeeId, res, raw, url: url.toString() };
      })
    );
    const disbursementsByCommittee = new Map<string, Array<Record<string, unknown>>>();
    for (const response of committeeDisbursementResponses) {
      if (!response.res.ok) continue;
      disbursementsByCommittee.set(response.committeeId, ((response.raw as { results?: Array<Record<string, unknown>> } | null)?.results ?? []));
    }
    const retrievedAt = new Date().toISOString();
    const results: RegulatorySearchResult[] = committeeRows.map((r) => {
      const committeeId = String(r?.committee_id ?? "").trim();
      const name = String(r?.name ?? "").trim();
      const type = String(r?.committee_type_full ?? r?.committee_type ?? "").trim();
      const designation = String(r?.designation_full ?? r?.designation ?? "").trim();
      const organizationType = String(r?.organization_type_full ?? r?.organization_type ?? "").trim();
      const state = String(r?.state ?? "").trim();
      const treasurer = String(r?.treasurer_name ?? "").trim();
      const connected = String(r?.connected_organization_name ?? "").trim();
      const confidence = matchConfidenceFromQuery(q, [name, connected, treasurer, state, designation, organizationType]);
      const detail = committeeId ? `https://www.fec.gov/data/committee/${encodeURIComponent(committeeId)}/` : "https://www.fec.gov/data/search/?tab=committees";
      const disbursementSummary = (disbursementsByCommittee.get(committeeId) ?? [])
        .slice(0, 3)
        .map((item) => {
          const recipient = String(item?.recipient_name ?? item?.recipient ?? "").trim();
          const total = typeof item?.disbursement_total === "number" ? `$${item.disbursement_total.toLocaleString()}` : "";
          return [recipient, total].filter(Boolean).join(" ");
        })
        .filter(Boolean);

      return {
        result_id: rid(),
        source_id: "fec",
        source_name: "FEC (OpenFEC)",
        agency: "FEC",
        category: "Campaign Finance / Political Contributions",
        query_used: q,
        matched_entity: name || q,
        matched_entity_confidence: confidence,
        title: name || "Committee",
        record_type: "committee",
        record_subtype: type || designation || undefined,
        description: [
          designation ? `Designation: ${designation}` : "",
          organizationType ? `Org type: ${organizationType}` : "",
          connected ? `Connected org: ${connected}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
        state: state || undefined,
        agency_identifier: committeeId || undefined,
        document_url: detail,
        detail_url: detail,
        raw_source_url: detail,
        raw_json: { committee: r, disbursements: disbursementsByCommittee.get(committeeId) ?? [] },
        confidence,
        importance_score: confidence === "High" ? 70 : confidence === "Medium" ? 45 : 20,
        notes: [
          treasurer ? `Treasurer: ${treasurer}` : "",
          disbursementSummary.length ? `Top disbursement recipients: ${disbursementSummary.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
        retrieved_at: retrievedAt,
        request_url: committeeUrl.toString().replace(/api_key=[^&]+/, "api_key=(redacted)"),
      };
    });

    const candidateResults: RegulatorySearchResult[] = candidateRows.map((r) => {
      const candidateId = String(r?.candidate_id ?? "").trim();
      const name = String(r?.name ?? "").trim();
      const office = String(r?.office_full ?? r?.office ?? "").trim();
      const party = String(r?.party_full ?? r?.party ?? "").trim();
      const state = String(r?.state ?? "").trim();
      const ey = r?.election_years;
      const years = Array.isArray(ey) ? ey : [];
      const cycle = String(years[0] ?? "").trim();
      const detail = candidateId ? `https://www.fec.gov/data/candidate/${encodeURIComponent(candidateId)}/` : "https://www.fec.gov/data/search/?tab=candidates";
      const confidence = matchConfidenceFromQuery(q, [name, office, party, state, cycle]);

      return {
        result_id: rid(),
        source_id: "fec",
        source_name: "FEC (OpenFEC)",
        agency: "FEC",
        category: "Campaign Finance / Political Contributions",
        query_used: q,
        matched_entity: name || q,
        matched_entity_confidence: confidence,
        title: name || "Candidate",
        record_type: "candidate",
        record_subtype: office || undefined,
        description: [party ? `Party: ${party}` : "", state ? `State: ${state}` : "", cycle ? `Cycle: ${cycle}` : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
        state: state || undefined,
        agency_identifier: candidateId || undefined,
        document_url: detail,
        detail_url: detail,
        raw_source_url: detail,
        raw_json: r,
        confidence,
        importance_score: confidence === "High" ? 55 : confidence === "Medium" ? 35 : 15,
        retrieved_at: retrievedAt,
        request_url: candidateUrl.toString().replace(/api_key=[^&]+/, "api_key=(redacted)"),
      };
    });

    const merged = [...results, ...candidateResults].sort((a, b) => {
      const rank = (value: string) => (value === "High" ? 2 : value === "Medium" ? 1 : 0);
      const diff = rank(b.confidence) - rank(a.confidence);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });

    return {
      ok: true,
      requestUrl: committeeUrl.toString().replace(/api_key=[^&]+/, "api_key=(redacted)"),
      raw: { committeeRaw, candidateRaw, committeeDisbursementResponses: committeeDisbursementResponses.map((item) => item.raw) },
      results: merged.slice(0, 25),
      warnings: committeeRes.ok ? undefined : ["Committee search was unavailable for this query; showing candidate matches only."],
    };
  },
};
