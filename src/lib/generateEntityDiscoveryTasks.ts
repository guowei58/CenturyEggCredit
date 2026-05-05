import type { CreditDocumentEntity, Exhibit21Subsidiary, EntityIntelligenceProfile } from "@/generated/prisma/client";
import type {
  EntityUniverseDiscoveryTaskCategory,
  EntityUniverseSourceCategory,
  EntityUniverseDiscoveryTaskWorkflowStatus,
} from "@/generated/prisma/client";

/** Output rows suitable for prisma.entityUniverseDiscoveryTask.createMany — caller supplies userId, ticker */
export type DiscoveryTaskDraft = {
  taskCategory: EntityUniverseDiscoveryTaskCategory;
  taskSubtype?: string | null;
  sourceCategory: EntityUniverseSourceCategory;
  searchTerm?: string | null;
  state?: string | null;
  jurisdiction: string;
  sourceUrl?: string | null;
  instructions: string;
  status: EntityUniverseDiscoveryTaskWorkflowStatus;
};

const UCC_KEYWORDS =
  /Funding|Finance|Receivables|Capital|Leasing|Trust|ABS|SPE|SPV|Asset Holdings|Intermediate Holdings|IP Holdings|Real Estate Holdings|Management|Services/gi;

const DOC_SUBTYPES: { st: string; label: string }[] = [
  { st: "credit_agreement", label: "Credit agreement" },
  { st: "indenture", label: "Indenture" },
  { st: "guarantee_agreement", label: "Guarantee agreement" },
  { st: "security_agreement", label: "Security agreement" },
  { st: "pledge_agreement", label: "Pledge agreement" },
  { st: "receivables_agreement", label: "Receivables / securitization package" },
  { st: "amendment", label: "Amendment stack" },
];

function rootPieces(name?: string | null): string[] {
  if (!name?.trim()) return [];
  const t = name.replace(/[,.\s]+/g, " ").trim();
  const parts = t.split(/\s+/);
  /** First substantive token bundle */
  if (parts[0]) return Array.from(new Set([parts.slice(0, 2).join(" "), parts[0]].filter(Boolean)));
  return [];
}

export function generateEntityDiscoveryTasksDraft(input: {
  profile?: Pick<EntityIntelligenceProfile, "publicRegistrantName" | "companyName" | "hqState" | "principalExecutiveOfficeAddress" | "majorOperatingStates"> | null;
  exhibitSubs: Pick<Exhibit21Subsidiary, "entityName" | "jurisdiction">[];
  creditPartyNames: Pick<CreditDocumentEntity, "entityName">[];
  ticker?: string;
}): DiscoveryTaskDraft[] {
  const out: DiscoveryTaskDraft[] = [];

  /** A. Credit-document extraction checklist */
  for (const { st, label } of DOC_SUBTYPES) {
    out.push({
      taskCategory: "credit_document_review",
      taskSubtype: st,
      sourceCategory: "credit_document",
      instructions: `${label}: capture borrower, issuer, guarantor, grantors, restricted / unrestricted subsidiaries, receivables and securitization vehicles with section references.`,
      jurisdiction: "",
      status: "not_started",
    });
  }

  /** B. UCC — root / party / Exhibit 21 / keyword combos */
  const roots = new Set<string>();
  for (const p of rootPieces(input.profile?.publicRegistrantName ?? input.profile?.companyName)) roots.add(p);
  if (input.ticker?.trim()) roots.add(input.ticker.trim());
  input.exhibitSubs.forEach((e) => rootPieces(e.entityName).forEach((r) => roots.add(r)));
  input.creditPartyNames.forEach((e) => rootPieces(e.entityName).forEach((r) => roots.add(r)));

  const states =
    Array.from(new Set(input.exhibitSubs.map((e) => (e.jurisdiction ?? "").slice(0, 2)).filter(Boolean))) ||
    (input.profile?.majorOperatingStates?.length ? [...input.profile.majorOperatingStates] : []);

  /** default to HQ jurisdiction when Exhibit 21 list empty */
  const defaultState = input.profile?.hqState?.slice(0, 2)?.toUpperCase() ?? "";

  const stateList =
    states.length > 0
      ? states.map((s) => s.trim().slice(0, 2).toUpperCase()).filter(Boolean)
      : defaultState
        ? [defaultState]
        : [""];

  for (const r of roots) {
    if (!r) continue;
    for (const st of stateList.length ? stateList : [""]) {
      out.push({
        taskCategory: "ucc_debtor_search",
        sourceCategory: "ucc_debtor_search",
        searchTerm: r,
        state: st || null,
        jurisdiction: st,
        instructions: `Run debtor index search for "${r}". Record filing number and official portal URL manually; paste summary into candidates.`,
        status: "not_started",
      });
    }
  }

  /** Finance keyword spinoffs tied to issuer root */
  const anchor = [...roots][0];
  if (anchor) {
    for (const frag of anchor.split(/\s+/).slice(0, 2)) {
      let m: RegExpExecArray | null;
      while ((m = UCC_KEYWORDS.exec(`${frag} ${anchor}`))) {
        void m;
      }
      for (const word of ["Funding", "Finance", "Receivables", "Capital", "Trust"]) {
        out.push({
          taskCategory: "ucc_debtor_search",
          sourceCategory: "ucc_debtor_search",
          searchTerm: `${frag} ${word}`.trim(),
          state: defaultState || null,
          jurisdiction: defaultState,
          instructions:
            `Targeted debtor search for probable finance subsidiary naming pattern (${word}); record official source link only.`,
          status: "not_started",
        });
      }
    }
  }

  /** C. SOS name-family roots */
  for (const r of roots) {
    if (!r) continue;
    for (const suf of ["", " Funding", " Finance", " Receivables", " Holdings", " IP Holdings"]) {
      out.push({
        taskCategory: "sos_name_family_search",
        sourceCategory: "sos_name_family_search",
        searchTerm: `${r}${suf}`.trim(),
        state: defaultState || null,
        jurisdiction: defaultState,
        instructions:
          "Secretary-of-state-style business entity lookup (manual portal use). Prefer exact official portal bookmarks; paste URL with notes.",
        status: "not_started",
      });
    }
  }

  /** D. Address-cluster */
  const addAddr = (
    addr: string | undefined,
    subtype: AddressClusterHints,
    hint: EntityUniverseSourceCategory
  ) => {
    if (!addr?.trim()) return;
    out.push({
      taskCategory: "address_cluster_search",
      sourceCategory: hint,
      searchTerm: addr.trim().slice(0, 280),
      state: defaultState || null,
      jurisdiction: defaultState,
      instructions: clusteringInstruction(subtype, addr.trim()),
      status: "not_started",
    });
  };

  /** pull HQ snippet from principal exec line if crude */
  if (input.profile?.principalExecutiveOfficeAddress) {
    addAddr(input.profile.principalExecutiveOfficeAddress, "principal", "address_cluster_search");
  }
  if ((input.profile as { hqCity?: string } | null)?.hqCity) {
    void 0;
  }

  /** major facility addresses skipped — profile lacks in pick; callers can extend */

  /** dedupe drafts by coarse key */
  const seen = new Set<string>();
  return out.filter((t) => {
    const key = `${t.taskCategory}|${t.searchTerm}|${t.state}|${t.taskSubtype ?? ""}|${t.instructions}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type AddressClusterHints = "principal" | "hq";

function clusteringInstruction(kind: AddressClusterHints, addr: string) {
  const base =
    kind === "principal"
      ? "Principal-office / HQ-style address clustering"
      : "Headquarters / registered-office clustering";
  return `${base}: search SOS / assessor overlays for co-located entities at "${addr.slice(0, 120)}${addr.length > 120 ? "…" : ""}" — treat hits as candidates only.`;
}
