export const ENTITY_UNIVERSE_TOP_COPY =
  "This tool builds a credit-relevant entity universe by combining Exhibit 21 subsidiaries, credit-document entities, UCC debtor searches, Secretary of State name-family searches, and address-cluster searches. Exhibit 21 is a starting point, not a complete entity map. Candidate entities are hypotheses requiring review.";

export const ENTITY_UNIVERSE_EXHIBIT21_NOTE =
  "Companies may omit certain subsidiaries from Exhibit 21 depending on materiality and disclosure rules. An entity not listed in Exhibit 21 is not automatically problematic.";

export const ENTITY_UNIVERSE_UCC_NOTE =
  "UCC debtor searches can reveal financing vehicles, receivables SPVs, leasing entities, collateral owners, and other entities relevant to secured financing. This workflow queues debtor-name variants and jurisdiction plans; official portals are often manual-only (CAPTCHA / login / paid access). Results stay investigative—not legal conclusions.";

export const ENTITY_UNIVERSE_SOS_NOTE =
  "Name-family searches are useful for discovering possible related entities, but name similarity alone is weak evidence. Combine name evidence with credit documents, UCC filings, addresses, officers, or other official records.";

export const ENTITY_UNIVERSE_ADDRESS_NOTE =
  "Shared addresses are leads, not conclusions. A shared HQ, principal office, property, permit, or credit-document notice address may indicate a related entity, but user review is required.";
