import type {
  VerifiedEntityRecord,
  KnownEntityInput,
  CandidateAffiliateEntity,
  EntityDiligenceIssue,
  EntityRelationship,
} from "@/generated/prisma/client";

function esc(s: string) {
  return s.replace(/\|/g, "\\|");
}

function mdTable(headers: string[], rows: string[][]) {
  const h = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => esc(String(c))).join(" | ")} |`).join("\n");
  return `${h}\n${sep}\n${body}`;
}

export type EntityIntelExportBundled = {
  generatedAtIso: string;
  ticker: string;
  markdownMemo: string;
  entityUniverseCsv: string;
  exhibit21ReconciliationCsv: string;
  creditPartyReconciliationCsv: string;
  candidatesCsv: string;
  relationshipsJson: EntityRelationship[];
};

export function exportEntityIntelligenceBundle(input: {
  ticker: string;
  companyLabel: string;
  known: KnownEntityInput[];
  verified: VerifiedEntityRecord[];
  candidates: CandidateAffiliateEntity[];
  issues: EntityDiligenceIssue[];
  relationships: EntityRelationship[];
}): EntityIntelExportBundled {
  const { ticker } = input;
  const now = new Date().toISOString();

  const uHeaders = [
    "entity_name",
    "verified_official_name",
    "role",
    "source_type",
    "state",
    "entity_id",
    "status",
    "confidence",
    "notes",
  ];
  const uRows: string[][] = [];

  const verByKnown = new Map<string, VerifiedEntityRecord[]>();
  for (const v of input.verified) {
    if (!v.knownEntityInputId) continue;
    verByKnown.set(v.knownEntityInputId, [...(verByKnown.get(v.knownEntityInputId) ?? []), v]);
  }

  for (const k of input.known) {
    const vv = verByKnown.get(k.id)?.[0];
    uRows.push([
      k.entityName,
      vv?.officialEntityName ?? "",
      k.entityRole,
      k.sourceType,
      vv?.state ?? k.jurisdictionHint ?? "",
      vv?.entityId ?? "",
      vv?.status ?? "",
      vv?.confidence ?? "",
      `${k.notes ?? ""} ${vv?.notes ?? ""}`.trim(),
    ]);
  }
  for (const v of input.verified) {
    if (!v.knownEntityInputId) {
      uRows.push([
        "(unlinked verified)",
        v.officialEntityName,
        "",
        "",
        v.state,
        v.entityId ?? "",
        v.status,
        v.confidence,
        v.notes ?? "",
      ]);
    }
  }
  const universeCsv = [
    uHeaders.join(","),
    ...uRows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const ex = input.known.filter((k) => k.sourceType === "exhibit_21");
  const eHeaders = ["exhibit21_entity", "verified", "sos_official_name", "state", "status", "mismatch", "notes"];
  const eRows: string[][] = ex.map((k) => {
    const vv = verByKnown
      .get(k.id)
      ?.find((x) => x.verificationStatus === "verified_exact_match" || x.verificationStatus === "verified_probable_match");
    const mismatch =
      vv && normalizeRough(k.entityName) !== normalizeRough(vv.officialEntityName)
        ? "possible official-name mismatch"
        : vv
          ? ""
          : "not verified";
    return [k.entityName, vv ? "yes" : "no", vv?.officialEntityName ?? "", vv?.state ?? "", vv?.status ?? "", mismatch, k.notes ?? ""];
  });
  const exhibitCsv = [
    eHeaders.join(","),
    ...eRows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const creditRoles = new Set<KnownEntityInput["entityRole"]>([
    "borrower",
    "guarantor",
    "issuer",
    "co_issuer",
    "collateral_owner",
  ]);
  const cp = input.known.filter((k) => creditRoles.has(k.entityRole));
  const cpHeaders = [
    "credit_party_name",
    "role",
    "document_hint",
    "listed_exhibit21_model",
    "verified",
    "sos_official",
    "state",
    "status",
    "issue_hint",
    "notes",
  ];
  const exNorm = new Set(ex.map((k) => k.normalizedEntityName));
  const cpRows: string[][] = cp.map((k) => {
    const vv = verByKnown.get(k.id)?.[0];
    const inEx = exNorm.has(k.normalizedEntityName);
    return [
      k.entityName,
      k.entityRole,
      k.sourceDocumentTitle ?? "",
      inEx ? "yes" : "no",
      vv ? "yes" : "no",
      vv?.officialEntityName ?? "",
      vv?.state ?? "",
      vv?.status ?? "",
      !inEx ? "may be not listed in Exhibit 21 (model)" : vv ? "" : "needs SOS follow-up",
      k.notes ?? "",
    ];
  });
  const creditCsv = [
    cpHeaders.join(","),
    ...cpRows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const cHeaders = ["candidate_name", "state", "discovery_method", "score", "confidence", "review_status", "evidence", "notes"];
  const cRows = input.candidates.map((c) => [
    c.candidateEntityName,
    c.state,
    c.discoveryMethod,
    String(Math.round(c.affiliationScore)),
    c.confidence,
    c.reviewStatus,
    JSON.stringify(c.evidenceJson ?? {}),
    c.notes ?? "",
  ]);
  const candCsv = [
    cHeaders.join(","),
    ...cRows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const openIssues = input.issues.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const verifiedOk = input.verified.filter(
    (v) => v.verificationStatus === "verified_exact_match" || v.verificationStatus === "verified_probable_match",
  );
  const memo = `# Entity verification memo — ${input.companyLabel} (${ticker})

_Generated ${now}._

## Executive summary

This diligence aid summarizes modeled entities, user-captured SOS results, reconciliation views, conservative candidate-affiliate hypotheses, and open workflow items. It is **not legal advice** and does not assert undisclosed subsidiaries.

## Verified SOS snapshots (probable/exact linkage)

${mdTable(
    ["Official name", "State", "Status", "Source"],
    verifiedOk.slice(0, 60).map((v) => [v.officialEntityName, v.state, String(v.status), v.sourceUrl]),
  )}

## Open workflow issues

${mdTable(
    ["Title", "Severity"],
    openIssues.slice(0, 60).map((i) => [i.issueTitle, String(i.severity)]),
  )}

## Candidate affiliates (hypotheses — requires user review)

${mdTable(
    ["Name", "Discovery", "Score", "Confidence", "Review"],
    input.candidates.slice(0, 60).map((c) => [
      c.candidateEntityName,
      c.discoveryMethod,
      String(Math.round(c.affiliationScore)),
      c.confidence,
      c.reviewStatus,
    ]),
  )}
`;

  return {
    generatedAtIso: now,
    ticker,
    markdownMemo: memo,
    entityUniverseCsv: universeCsv,
    exhibit21ReconciliationCsv: exhibitCsv,
    creditPartyReconciliationCsv: creditCsv,
    candidatesCsv: candCsv,
    relationshipsJson: input.relationships,
  };
}

function normalizeRough(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
}
