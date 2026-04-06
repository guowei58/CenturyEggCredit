import type { EnvRiskSnapshot } from "@/lib/env-risk/types";

export function buildInvestorNarrative(s: EnvRiskSnapshot): EnvRiskSnapshot["narrative"] {
  const fc = s.facilities.length;
  const high = s.facilities.filter((f) => f.match_confidence === "high").length;
  const enf = s.facilities.reduce((n, f) => n + f.enforcement_flags.length, 0);
  const disp = s.disclosure_rows.length;

  const bottom_line =
    fc === 0 && disp < 4
      ? "Limited automated signal: few environmental text hits in sampled filings and no confident federal facility linkage. Treat as incomplete — not clean."
      : `Automated pass found ${disp} disclosure excerpts across sampled SEC documents and ${fc} federal registry rows tentatively tied to the issuer's name set (${high} high-confidence name matches). Sub-scores are heuristic; verify material items in source filings and ECHO detail pages.`;

  const what_company_discloses =
    disp === 0
      ? "No environmental keyword windows were extracted from the filing sample (may mean clean HTML, non-primary doc, or keywords outside the scanned body)."
      : `Sampled filings include ${disp} environment-related text windows spanning: ${Array.from(new Set(s.disclosure_rows.map((d) => d.topic)))
          .slice(0, 12)
          .join(", ")}. Quantified amounts were captured only where dollar patterns appeared near those windows — not a substitute for reading footnotes.`;

  const what_regulatory_data_shows =
    fc === 0
      ? "No merged FRS/ECHO facilities for the constructed alias list. Common causes: retail/light-asset models, DE holding companies, or name mismatch vs. facility operator legal names."
      : `ECHO/FRS merged view surfaces ${fc} facilities. Enforcement strings appear on ${s.facilities.filter((f) => f.enforcement_flags.length > 0).length} rows; significant noncompliance flags on ${s.facilities.filter((f) => f.compliance_flags.some((c) => /significant|violation/i.test(c))).length}. This is federal index data only.`;

  const where_main_risk_sits =
    enf > 0
      ? "Primary automated emphasis: enforcement/compliance fields on matched ECHO rows and any legal/remediation language in filings."
      : s.scores.waste_cleanup_risk >= s.scores.compliance_risk
        ? "Model tilts toward waste/cleanup/remediation keywords and RCRA-style flags more than active enforcement counts."
        : "Model tilts toward disclosure breadth and permit/compliance density across matched sites.";

  const hidden_liabilities_capex =
    "Reserve / ARO / remediation figures require structured XBRL or manual note extraction — this workflow uses text windows only. Capex tied to environmental spend is flagged only when phrasing matches heuristics. Bond/loan environmental covenants are out of scope here.";

  const facilities_states_to_monitor =
    s.state_follow_up
      .filter((r) => r.priority === "high")
      .map((r) => r.state)
      .join(", ") ||
    Array.from(new Set(s.facilities.map((f) => f.state).filter((x): x is string => Boolean(x))))
      .slice(0, 8)
      .join(", ") ||
    "—";

  const benign_or_low_risk =
    enf === 0 && s.scores.enforcement_risk < 25 && s.scores.compliance_risk < 35
      ? "Federal compliance fields are quiet in the matched set — still verify for material subsidiaries omitted from the alias list."
      : "Some federal rows carry compliance/enforcement strings; distinguish corporate materiality vs. de minimis site-level noise.";

  const open_questions =
    "Are major operating subsidiaries missing from Exhibit 21 / saved subsidiary list? Do facilities operate under different EPA IDs than the parent name? Are state air/waste permits the binding constraint (not captured in v1)? Any off-balance-sheet indemnities or purchased environmental insurance?";

  return {
    bottom_line,
    what_company_discloses,
    what_regulatory_data_shows,
    where_main_risk_sits,
    hidden_liabilities_capex,
    facilities_states_to_monitor,
    benign_or_low_risk,
    open_questions,
  };
}
