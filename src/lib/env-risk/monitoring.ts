import type { EnvRiskSnapshot } from "@/lib/env-risk/types";

export function diffSnapshots(prev: EnvRiskSnapshot | null, next: EnvRiskSnapshot) {
  if (!prev) {
    return {
      new_env_language_in_latest_filing: false,
      new_facility_matches: next.facilities.length,
      material_score_change: false,
      new_enforcement_flags: next.facilities.reduce((n, f) => n + f.enforcement_flags.length, 0),
      notes: ["First successful run — baseline established."],
    } satisfies EnvRiskSnapshot["monitoring"];
  }

  const notes: string[] = [];
  const prevRegs = new Set(prev.facilities.map((f) => f.registry_id).filter(Boolean) as string[]);
  const nextRegs = new Set(next.facilities.map((f) => f.registry_id).filter(Boolean) as string[]);
  let newFac = 0;
  for (const r of Array.from(nextRegs)) if (!prevRegs.has(r)) newFac++;

  const scoreDelta = Math.abs(prev.scores.overall_environmental_risk - next.scores.overall_environmental_risk);
  const material_score_change = scoreDelta >= 12;

  const prevEnf = prev.facilities.reduce((n, f) => n + f.enforcement_flags.length, 0);
  const nextEnf = next.facilities.reduce((n, f) => n + f.enforcement_flags.length, 0);

  const latestDates = next.filing_summaries.map((f) => f.filing_date).sort((a, b) => b.localeCompare(a));
  const prevLatest = prev.filing_summaries.map((f) => f.filing_date).sort((a, b) => b.localeCompare(a))[0];
  const newLatest = latestDates[0];
  const new_env_language_in_latest_filing =
    Boolean(newLatest && newLatest !== prevLatest && next.disclosure_rows.some((d) => d.filing_date === newLatest));

  if (newFac > 0) notes.push(`${newFac} new registry ID(s) appeared in the federal merge.`);
  if (material_score_change) notes.push(`Overall model score moved by ${scoreDelta} points.`);
  if (nextEnf > prevEnf) notes.push("Enforcement flag count increased on facility rows.");

  return {
    new_env_language_in_latest_filing,
    new_facility_matches: newFac,
    material_score_change,
    new_enforcement_flags: Math.max(0, nextEnf - prevEnf),
    notes,
  } satisfies EnvRiskSnapshot["monitoring"];
}
