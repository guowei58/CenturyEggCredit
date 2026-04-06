import type { CanonicalEnvProfile } from "@/lib/env-risk/types";

export type StateAgencyFollowUpHint = {
  state: string;
  rationale: string;
  priority: "high" | "medium" | "low";
};

export interface StateAgencyService {
  /** Future: query state portals (TCEQ, CalEPA, etc.). v1 returns heuristics only. */
  suggestFollowUps(profile: CanonicalEnvProfile, facilityStates: string[]): Promise<StateAgencyFollowUpHint[]>;
}

export class StateAgencyStub implements StateAgencyService {
  async suggestFollowUps(
    profile: CanonicalEnvProfile,
    facilityStates: string[]
  ): Promise<StateAgencyFollowUpHint[]> {
    const states = Array.from(new Set(facilityStates.filter(Boolean)));
    const incorp = profile.state_of_incorporation?.trim();
    const out: StateAgencyFollowUpHint[] = [];
    for (const st of states.slice(0, 15)) {
      const many = facilityStates.filter((s) => s === st).length >= 8;
      out.push({
        state: st,
        rationale: many
          ? `High facility count in ${st} in federal index — state air/waste permits and enforcement may dominate exposure.`
          : `Operating presence in ${st} — verify state agency databases (air, waste, storage tanks) for this issuer.`,
        priority: many ? "high" : facilityStates.length > 5 ? "medium" : "low",
      });
    }
    if (incorp && incorp !== "DE" && incorp.length === 2 && !states.includes(incorp)) {
      out.push({
        state: incorp,
        rationale: `Incorporated in ${incorp}; cross-check domestic legal-entity registrations and any state-specific environmental dockets.`,
        priority: "low",
      });
    }
    return out;
  }
}
