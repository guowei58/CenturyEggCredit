import type { EnvRiskRuntimeConfig } from "@/lib/env-risk/config";
import { buildAliasQueries } from "@/lib/env-risk/company-profile-builder";
import { echoFacilityDetailUrl, echoSearchFacilitiesByName } from "@/lib/env-risk/providers/echo-service";
import {
  frsSearchFacilityNameContains,
  type FrsSiteRow,
} from "@/lib/env-risk/providers/envirofacts-frs";
import { rcraSignalsFromEchoRow } from "@/lib/env-risk/providers/rcra-service";
import { diceCoefficient, tokenOverlapScore } from "@/lib/env-risk/text-utils";
import type {
  CanonicalEnvProfile,
  EchoFacilityRaw,
  FacilityOverridesFile,
  MatchConfidence,
  ResolvedFacility,
} from "@/lib/env-risk/types";

function confidenceFromScore(score: number, override: "confirmed" | "rejected" | "none"): MatchConfidence {
  if (override === "confirmed") return "high";
  if (override === "rejected") return "unresolved";
  if (score >= 0.52) return "high";
  if (score >= 0.28) return "medium";
  if (score >= 0.12) return "low";
  return "unresolved";
}

function bestAliasScore(name: string, aliases: string[]): number {
  let best = 0;
  for (const a of aliases) {
    best = Math.max(best, diceCoefficient(name, a), tokenOverlapScore(name, a));
  }
  return best;
}

function flagsFromEcho(row: EchoFacilityRaw): {
  compliance: string[];
  enforcement: string[];
  emissions: string[];
  waste: string[];
} {
  const compliance: string[] = [];
  const enforcement: string[] = [];
  const emissions: string[] = [];
  const waste: string[] = [];

  const snc = (row.FacSNCFlg || "").toUpperCase();
  if (snc === "Y") compliance.push("Significant noncompliance flag (ECHO)");
  const cs = (row.FacComplianceStatus || "").trim();
  if (cs) compliance.push(cs);
  const cwa = (row.CWAComplianceStatus || "").trim();
  if (cwa) compliance.push(`CWA: ${cwa}`);
  const caa = (row.CAAComplianceStatus || "").trim();
  if (caa) compliance.push(`CAA: ${caa}`);

  const pc = (row.FacPenaltyCount || "").trim();
  if (pc && pc !== "0") enforcement.push(`Penalties count: ${pc}`);
  const fa = (row.FacDateLastFormalAction || "").trim();
  if (fa) enforcement.push(`Last formal action: ${fa}`);
  const lp = (row.FacDateLastPenalty || "").trim();
  if (lp) enforcement.push(`Last penalty: ${lp}`);

  if ((row.TRIFlag || "").toUpperCase() === "Y") emissions.push("TRI reporter (ECHO)");
  const triq = (row.TRIOnSiteReleases || "").trim();
  if (triq) emissions.push(`TRI on-site releases field: ${triq.slice(0, 40)}`);
  if ((row.AIRFlag || "").toUpperCase() === "Y") emissions.push("CAA regulated (ECHO)");

  waste.push(...rcraSignalsFromEchoRow(row));

  return { compliance, enforcement, emissions, waste };
}

function mergeRows(
  registryId: string,
  frs: FrsSiteRow | undefined,
  echo: EchoFacilityRaw | undefined,
  aliases: string[],
  overrides: FacilityOverridesFile
): ResolvedFacility {
  const name =
    (echo?.FacName && String(echo.FacName)) ||
    frs?.primary_name ||
    `Registry ${registryId}`;
  const state = (echo?.FacState && String(echo.FacState)) || frs?.state_code || null;
  const city = (echo?.FacCity && String(echo.FacCity)) || frs?.city_name || null;
  const addr =
    (echo?.FacStreet && String(echo.FacStreet)) ||
    frs?.std_loc_address ||
    frs?.location_address ||
    null;

  const score = bestAliasScore(name, aliases);
  const rid = registryId;
  let o: "confirmed" | "rejected" | "none" = "none";
  if (overrides.confirmed_registry_ids.includes(rid)) o = "confirmed";
  if (overrides.rejected_registry_ids.includes(rid)) o = "rejected";

  const echoFlags = echo ? flagsFromEcho(echo) : { compliance: [], enforcement: [], emissions: [], waste: [] };

  const source: ResolvedFacility["source"] =
    frs && echo ? "merged" : frs ? "frs" : echo ? "echo" : "merged";

  return {
    id: rid,
    registry_id: rid,
    facility_name: name,
    state,
    city,
    address_line: addr,
    matched_entity: aliases[0] ?? "",
    match_confidence: confidenceFromScore(score, o),
    match_score: Math.round(score * 100) / 100,
    business_segment: null,
    source,
    compliance_flags: echoFlags.compliance,
    enforcement_flags: echoFlags.enforcement,
    emissions_flags: echoFlags.emissions,
    waste_flags: echoFlags.waste,
    echo_detail_url: echoFacilityDetailUrl(rid),
    raw_echo: echo ?? null,
    override_status: o === "none" ? "none" : o,
  };
}

export async function resolveFacilitiesFederal(params: {
  profile: CanonicalEnvProfile;
  cfg: EnvRiskRuntimeConfig;
  overrides: FacilityOverridesFile;
  errors: string[];
}): Promise<ResolvedFacility[]> {
  const { profile, cfg, overrides, errors } = params;
  const aliases = buildAliasQueries(profile, 20);
  if (aliases.length === 0) return [];

  const byReg = new Map<string, { frs?: FrsSiteRow; echo?: EchoFacilityRaw }>();

  if (cfg.envirofactsEnabled) {
    let nq = 0;
    for (const alias of buildAliasQueries(profile, cfg.maxFrsQueries)) {
      if (nq >= cfg.maxFrsQueries) break;
      nq++;
      const { rows, error } = await frsSearchFacilityNameContains(alias, cfg, 12);
      if (error) errors.push(`FRS (${alias.slice(0, 24)}…): ${error}`);
      for (const r of rows) {
        const id = r.registry_id;
        if (!id) continue;
        const cur = byReg.get(id) ?? {};
        cur.frs = r;
        byReg.set(id, cur);
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  if (cfg.echoEnabled) {
    let eq = 0;
    for (const alias of buildAliasQueries(profile, cfg.maxEchoNameQueries)) {
      if (eq >= cfg.maxEchoNameQueries) break;
      eq++;
      const { facilities, error } = await echoSearchFacilitiesByName(alias, cfg);
      if (error) errors.push(`ECHO (${alias.slice(0, 24)}…): ${error}`);
      for (const row of facilities) {
        const id = row.RegistryID != null ? String(row.RegistryID).trim() : "";
        if (!id) continue;
        const cur = byReg.get(id) ?? {};
        cur.echo = row;
        byReg.set(id, cur);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const out: ResolvedFacility[] = [];
  for (const [reg, pair] of Array.from(byReg.entries())) {
    out.push(mergeRows(reg, pair.frs, pair.echo, aliases, overrides));
  }

  out.sort((a, b) => {
    const sa = scoreFacility(a);
    const sb = scoreFacility(b);
    if (sb !== sa) return sb - sa;
    return a.facility_name.localeCompare(b.facility_name);
  });

  return out.slice(0, 80);
}

function scoreFacility(f: ResolvedFacility): number {
  let s = f.match_score * 40;
  s += f.compliance_flags.length * 6;
  s += f.enforcement_flags.length * 10;
  s += f.emissions_flags.length * 4;
  s += f.waste_flags.length * 5;
  if (f.override_status === "confirmed") s += 25;
  return s;
}
