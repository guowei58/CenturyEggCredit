import type {
  KnownEntityRole,
  KnownEntitySourceType,
} from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

type PrPublic = {
  companyName?: string | null;
  ticker: string;
  legalNames?: string[];
  subsidiaryNames?: string[];
  subsidiaryDomiciles?: string[];
  borrowerNames?: string[];
  guarantorNames?: string[];
  issuerNames?: string[];
  dbaNames?: string[];
  formerNames?: string[];
  restrictedSubsidiaryNames?: string[];
  unrestrictedSubsidiaryNames?: string[];
};

export type KnownBootstrapRow = {
  entityName: string;
  normalizedEntityName: string;
  sourceType: KnownEntitySourceType;
  entityRole: KnownEntityRole;
  jurisdictionHint: string | null;
};

/** Build deterministic seed rows from Public Records Profile (no DB side effects). */
export function bootstrapKnownEntitiesFromPublicProfile(pr: PrPublic): KnownBootstrapRow[] {
  const rows: KnownBootstrapRow[] = [];
  const primary = pr.companyName?.trim();

  function push(entityName: string, sourceType: KnownEntitySourceType, role: KnownEntityRole, jurisdictionHint?: string | null) {
    const n = entityName.trim();
    if (!n) return;
    const { normalized } = normalizeEntityName(n);
    rows.push({
      entityName: n,
      normalizedEntityName: normalized,
      sourceType,
      entityRole: role,
      jurisdictionHint: jurisdictionHint?.trim() || null,
    });
  }

  if (primary) push(primary, "ten_k", "public_parent", null);

  const subs = pr.subsidiaryNames ?? [];
  const doms = pr.subsidiaryDomiciles ?? [];
  for (let i = 0; i < subs.length; i++) {
    push((subs[i] ?? "").trim(), "exhibit_21", "subsidiary", doms[i] ?? null);
  }

  for (const n of pr.borrowerNames ?? []) push(n, "credit_agreement", "borrower", null);
  for (const n of pr.guarantorNames ?? []) push(n, "credit_agreement", "guarantor", null);
  for (const n of pr.issuerNames ?? []) push(n, "credit_agreement", "issuer", null);
  for (const n of pr.dbaNames ?? []) push(n, "company_website", "dba", null);
  for (const n of pr.formerNames ?? []) push(n, "prior_research", "former_name", null);
  for (const n of pr.restrictedSubsidiaryNames ?? []) push(n, "credit_agreement", "restricted_subsidiary", null);
  for (const n of pr.unrestrictedSubsidiaryNames ?? []) push(n, "credit_agreement", "unrestricted_subsidiary", null);

  /** Dedupe by normalized name + role + source */
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.normalizedEntityName}|${r.entityRole}|${r.sourceType}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
