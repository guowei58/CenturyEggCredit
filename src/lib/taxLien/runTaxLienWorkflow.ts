import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";
import { debtorSearchVariants } from "@/lib/ucc/nameVariants";
import { usStateAbbrFromText } from "@/lib/usStates";
import { UNKNOWN_JURISDICTION_CODE } from "@/lib/ucc/stateCapabilityRegistry";
import { buildTaxLienSearchPlan } from "@/lib/taxLien/buildTaxLienSearchPlan";
import { getTaxLienStateCapability } from "@/lib/taxLien/stateTaxLienCapabilityRegistry";
import {
  COUNTY_RECORDER_DOC_TYPES,
  FEDERAL_TAX_LIEN_DOC_TYPES,
  STATE_TAX_LIEN_DOC_TYPES,
} from "@/lib/taxLien/suggestedDocumentTypes";

const MAX_MANUAL_TASKS_PER_RUN = 3500;
/** Interactive tx default is 5s; remote Postgres + many Exhibit 21 rows exceeds that. */
const TAX_LIEN_TX_TIMEOUT_MS = 180_000;
const ENTITY_UNIVERSE_STAMP_CHUNK = 24;

type SourceTag = "exhibit21_profile" | "exhibit21_synced" | "user_added" | "parent_issuer";

type MergedAcc = {
  norm: string;
  displayName: string;
  formationRaw: string | null;
  formationAbbr: string | null;
  entityType: string | null;
  principalOfficeAddress: string | null;
  mailingAddress: string | null;
  registeredOfficeAddress: string | null;
  uccDebtorAddress: string | null;
  aliases: Set<string>;
  sources: Set<SourceTag>;
  isParentIssuer: boolean;
  sourceFiling: string | null;
  sourceDate: Date | null;
};

function mergeKey(norm: string, isParent: boolean): string {
  return `${norm}|${isParent ? "P" : "S"}`;
}

function reasonManualForCapability(state: string): string {
  const cap = getTaxLienStateCapability(state);
  const parts = [
    `Tax lien adapter "${cap.adapter_status}" for ${cap.state_name} (${cap.state}).`,
    cap.automation_allowed === false ? "Automation disabled in registry until official access is validated." : "",
    cap.county_search_required === true
      ? "County recorder / land records often required for NFTLs — confirm county from addresses."
      : "",
    cap.notes,
  ];
  return parts.filter(Boolean).join(" ");
}

export async function runTaxLienWorkflow(opts: {
  prisma: PrismaClient;
  userId: string;
  ticker: string;
  nationalSweep: boolean;
  webFallbackEnabled: boolean;
  deepNameVariants: boolean;
  publicRecordsSubsidiaries: {
    subsidiaryExhibit21Snapshot?: unknown;
    subsidiaryNames?: string[];
    subsidiaryDomiciles?: string[];
  } | null;
}): Promise<{
  ok: true;
  candidatesCreated: number;
  manualTasksCreated: number;
  mergedEntities: number;
  tasksCapped: boolean;
}> {
  const { prisma, userId, ticker } = opts;

  const [ex21Synced, masterRows, addrClusters, publicRecordsProf, intelProfile] = await Promise.all([
    prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }).catch(() => []),
    prisma.entityUniverseItem
      .findMany({
        where: { userId, ticker, primarySourceCategory: "user_added" },
        orderBy: { updatedAt: "desc" },
      })
      .catch(() => []),
    prisma.addressClusterCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }).catch(() => []),
    prisma.publicRecordsProfile.findUnique({ where: { userId_ticker: { userId, ticker } } }).catch(() => null),
    prisma.entityIntelligenceProfile.findFirst({ where: { userId, ticker } }).catch(() => null),
  ]);

  const profileRowsFromDb =
    publicRecordsProf != null
      ? subsidiaryTableRowsFromSavedProfile(
          publicRecordsProf.subsidiaryExhibit21Snapshot,
          publicRecordsProf.subsidiaryNames,
          publicRecordsProf.subsidiaryDomiciles
        )
      : [];

  const profileRowsFromClient = opts.publicRecordsSubsidiaries
    ? subsidiaryTableRowsFromSavedProfile(
        opts.publicRecordsSubsidiaries.subsidiaryExhibit21Snapshot,
        opts.publicRecordsSubsidiaries.subsidiaryNames,
        opts.publicRecordsSubsidiaries.subsidiaryDomiciles
      )
    : [];

  const profileRows = profileRowsFromClient.length > 0 ? profileRowsFromClient : profileRowsFromDb;

  const merged = new Map<string, MergedAcc>();

  function touch(
    exactName: string,
    formationRaw: string | null | undefined,
    tag: SourceTag,
    patch: Partial<Omit<MergedAcc, "norm" | "sources" | "aliases">> & { alias?: string | null },
    isParentIssuer: boolean
  ) {
    const trimmed = exactName.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    const norm = normalizeEntityName(trimmed).normalized;
    if (!norm) return;
    const fabbr =
      usStateAbbrFromText((formationRaw ?? "").trim()) ||
      (formationRaw?.trim() ? usStateAbbrFromText(formationRaw) : null);
    const key = mergeKey(norm, isParentIssuer);
    const prev = merged.get(key);
    const alias = patch.alias?.trim();
    if (!prev) {
      merged.set(key, {
        norm,
        displayName: trimmed,
        formationRaw: formationRaw?.trim() ? formationRaw.trim() : null,
        formationAbbr: fabbr,
        entityType: patch.entityType ?? null,
        principalOfficeAddress: patch.principalOfficeAddress ?? null,
        mailingAddress: patch.mailingAddress ?? null,
        registeredOfficeAddress: patch.registeredOfficeAddress ?? null,
        uccDebtorAddress: patch.uccDebtorAddress ?? null,
        aliases: new Set(alias ? [alias] : []),
        sources: new Set([tag]),
        isParentIssuer,
        sourceFiling: patch.sourceFiling ?? null,
        sourceDate: patch.sourceDate ?? null,
      });
      return;
    }
    prev.sources.add(tag);
    if (alias) prev.aliases.add(alias);
    if (trimmed.length > prev.displayName.length) prev.displayName = trimmed;
    if (!prev.formationRaw && formationRaw?.trim()) prev.formationRaw = formationRaw.trim();
    if (!prev.formationAbbr && fabbr) prev.formationAbbr = fabbr;
    prev.entityType = prev.entityType ?? patch.entityType ?? null;
    prev.principalOfficeAddress = prev.principalOfficeAddress ?? patch.principalOfficeAddress ?? null;
    prev.mailingAddress = prev.mailingAddress ?? patch.mailingAddress ?? null;
    prev.registeredOfficeAddress = prev.registeredOfficeAddress ?? patch.registeredOfficeAddress ?? null;
    prev.uccDebtorAddress = prev.uccDebtorAddress ?? patch.uccDebtorAddress ?? null;
    prev.sourceFiling = prev.sourceFiling ?? patch.sourceFiling ?? null;
    prev.sourceDate = prev.sourceDate ?? patch.sourceDate ?? null;
  }

  for (const row of profileRows) {
    if (!row.name.trim()) continue;
    touch(row.name, row.domicile || null, "exhibit21_profile", {}, false);
  }
  for (const r of ex21Synced) {
    touch(r.entityName, r.jurisdiction, "exhibit21_synced", { sourceFiling: r.source10KTitle, sourceDate: null }, false);
  }
  for (const r of masterRows) {
    touch(
      r.entityName,
      r.jurisdiction || null,
      "user_added",
      {
        entityType: r.entityType,
        principalOfficeAddress: r.principalOfficeAddress,
        mailingAddress: r.mailingAddress,
        registeredOfficeAddress: r.registeredAgentAddress,
      },
      false
    );
  }

  if (publicRecordsProf) {
    const legal =
      (publicRecordsProf.legalNames?.find((x) => x.trim()) ?? "").trim() ||
      (publicRecordsProf.companyName ?? "").trim();
    if (legal) {
      touch(
        legal,
        publicRecordsProf.stateOfIncorporation,
        "parent_issuer",
        {
          principalOfficeAddress: publicRecordsProf.principalExecutiveOfficeAddress,
          mailingAddress: null,
          registeredOfficeAddress: null,
          sourceFiling: "Public Records Profile (issuer)",
        },
        true
      );
    }
  }

  const addrByNorm = new Map<string, string>();
  for (const r of addrClusters) {
    const nk = r.normalizedCandidateEntityName.trim();
    if (!nk) continue;
    const line = r.matchedAddress.trim();
    if (!line) continue;
    const prev = addrByNorm.get(nk);
    if (!prev || line.length > prev.length) addrByNorm.set(nk, line);
  }
  for (const acc of merged.values()) {
    const line = addrByNorm.get(acc.norm);
    if (line && !acc.uccDebtorAddress) acc.uccDebtorAddress = line;
  }

  const formationForPlan = (acc: MergedAcc) => acc.formationRaw ?? acc.formationAbbr ?? "";

  const candidateRows: Prisma.TaxLienWorkflowCandidateCreateManyInput[] = [];
  const manualTasks: Prisma.TaxLienManualSearchTaskCreateManyInput[] = [];
  let tasksCapped = false;

  for (const acc of merged.values()) {
    const variants = debtorSearchVariants(acc.displayName, { broadNameFamily: opts.deepNameVariants }).slice(0, 36);
    if (variants.length === 0) continue;

    const plan = buildTaxLienSearchPlan({
      formationJurisdictionRaw: formationForPlan(acc),
      principalOfficeAddress: acc.principalOfficeAddress,
      mailingAddress: acc.mailingAddress,
      registeredOfficeAddress: acc.registeredOfficeAddress,
      uccDebtorAddress: acc.uccDebtorAddress,
      hqStateRaw: publicRecordsProf?.hqState,
      hqCounty: publicRecordsProf?.hqCounty,
      principalExecutiveOfficeAddress: acc.isParentIssuer ? publicRecordsProf?.principalExecutiveOfficeAddress : null,
      intelMajorOperatingStates: intelProfile?.majorOperatingStates ?? [],
      intelFacilityAddresses: intelProfile?.majorFacilityAddresses ?? [],
      intelPrincipalExecutiveOfficeAddress: intelProfile?.principalExecutiveOfficeAddress,
      profileFacilityLocationJson: publicRecordsProf?.majorFacilityLocations,
      profilePropertyLocationJson: publicRecordsProf?.knownPropertyLocations,
      profilePermitJurisdictionsJson: publicRecordsProf?.knownPermitJurisdictions,
      nationalSweep: opts.nationalSweep,
      webFallbackEnabled: opts.webFallbackEnabled,
      deepNameVariants: opts.deepNameVariants,
    });

    const searchStates =
      plan.searchStates.length > 0 ? plan.searchStates : [UNKNOWN_JURISDICTION_CODE];

    const formationSt =
      acc.formationAbbr && /^[A-Z]{2}$/.test(acc.formationAbbr) ? acc.formationAbbr : UNKNOWN_JURISDICTION_CODE;

    const aliasesArr = [...acc.aliases].filter(Boolean);

    candidateRows.push({
      userId,
      ticker,
      entityLegalName: acc.displayName,
      normalizedEntityName: acc.norm,
      isParentIssuer: acc.isParentIssuer,
      formationJurisdictionRaw: acc.formationRaw,
      formationStateAbbr: formationSt,
      entityType: acc.entityType,
      principalOfficeAddress: acc.principalOfficeAddress,
      mailingAddress: acc.mailingAddress,
      registeredOfficeAddress: acc.registeredOfficeAddress,
      uccDebtorAddress: acc.uccDebtorAddress,
      aliasesJson: aliasesArr.length ? aliasesArr : undefined,
      sourceFiling: acc.sourceFiling,
      sourceDate: acc.sourceDate,
      searchJurisdictionsJson: searchStates,
      searchCountiesJson: plan.countyHints,
      queryVariantsJson: variants,
      searchPlanJson: {
        ...plan,
        entitySources: [...acc.sources].sort(),
        disclaimer:
          "Research/diligence aid only — not legal advice. Confirm filings with official custodians; federal releases withdraw NFTLs differently from releases.",
      } as unknown as Prisma.InputJsonValue,
      workflowSearchStatus: "manual_queue",
      resultsFound: 0,
      manualRequired: true,
      workflowEntitySources: [...acc.sources].sort().join(";"),
      notes: [
        plan.reasonParts.join(" "),
        opts.webFallbackEnabled
          ? "Web/search fallback enabled in plan — run separate diligence; downrank unverified sources."
          : "Web fallback disabled — enable in run options if needed.",
      ]
        .filter(Boolean)
        .join(" "),
      federalTaxLienFound: false,
      stateTaxLienFound: false,
      taxLienReleased: false,
      unreleasedTaxLienFlag: false,
      sourceEvidenceCount: 0,
      highestMatchConfidence: "unknown",
      mapperManualReviewRequired: true,
    });
  }

  await prisma.$transaction(
    async (tx) => {
    await tx.taxLienManualSearchTask.deleteMany({ where: { userId, ticker } });
    await tx.taxLienDocument.deleteMany({ where: { userId, ticker } });
    await tx.taxLienWorkflowCandidate.deleteMany({ where: { userId, ticker } });

    if (candidateRows.length) {
      await tx.taxLienWorkflowCandidate.createMany({ data: candidateRows });
    }

    const saved = await tx.taxLienWorkflowCandidate.findMany({
      where: { userId, ticker },
      select: {
        id: true,
        normalizedEntityName: true,
        isParentIssuer: true,
        entityLegalName: true,
        searchJurisdictionsJson: true,
        queryVariantsJson: true,
      },
    });

    const idByKey = new Map(saved.map((r) => [mergeKey(r.normalizedEntityName, r.isParentIssuer), r.id]));

    outer: for (const acc of merged.values()) {
      const variants = debtorSearchVariants(acc.displayName, { broadNameFamily: opts.deepNameVariants }).slice(0, 36);
      if (!variants.length) continue;
      const candId = idByKey.get(mergeKey(acc.norm, acc.isParentIssuer));
      if (!candId) continue;

      const plan = buildTaxLienSearchPlan({
        formationJurisdictionRaw: formationForPlan(acc),
        principalOfficeAddress: acc.principalOfficeAddress,
        mailingAddress: acc.mailingAddress,
        registeredOfficeAddress: acc.registeredOfficeAddress,
        uccDebtorAddress: acc.uccDebtorAddress,
        hqStateRaw: publicRecordsProf?.hqState,
        hqCounty: publicRecordsProf?.hqCounty,
        principalExecutiveOfficeAddress: acc.isParentIssuer ? publicRecordsProf?.principalExecutiveOfficeAddress : null,
        intelMajorOperatingStates: intelProfile?.majorOperatingStates ?? [],
        intelFacilityAddresses: intelProfile?.majorFacilityAddresses ?? [],
        intelPrincipalExecutiveOfficeAddress: intelProfile?.principalExecutiveOfficeAddress,
        profileFacilityLocationJson: publicRecordsProf?.majorFacilityLocations,
        profilePropertyLocationJson: publicRecordsProf?.knownPropertyLocations,
        profilePermitJurisdictionsJson: publicRecordsProf?.knownPermitJurisdictions,
        nationalSweep: opts.nationalSweep,
        webFallbackEnabled: opts.webFallbackEnabled,
        deepNameVariants: opts.deepNameVariants,
      });

      const searchStates =
        plan.searchStates.length > 0 ? plan.searchStates : [UNKNOWN_JURISDICTION_CODE];

      const filtersJson = {
        federalNftl: FEDERAL_TAX_LIEN_DOC_TYPES,
        stateTax: STATE_TAX_LIEN_DOC_TYPES,
        countyRecorder: COUNTY_RECORDER_DOC_TYPES,
      };

      for (const st of searchStates) {
        const cap = getTaxLienStateCapability(st);
        const countyHint = plan.countyHints.find((c) => c.stateAbbr === st)?.countyName ?? null;
        const url = cap.official_search_url.trim();

        if (manualTasks.length >= MAX_MANUAL_TASKS_PER_RUN) {
          tasksCapped = true;
          break outer;
        }

        manualTasks.push({
          userId,
          ticker,
          candidateId: candId,
          entityLegalName: acc.displayName,
          stateAbbr: st,
          countyName: countyHint,
          reasonManual: reasonManualForCapability(st),
          searchUrl: url || "(no verified portal URL in registry — identify SOS/DOR/county recorder manually)",
          exactSearchQuery: variants[0] ?? acc.displayName,
          suggestedDocTypeFiltersJson: filtersJson as unknown as Prisma.InputJsonValue,
          taskStatus: "open",
        });

        if (cap.county_search_required === true && countyHint && manualTasks.length < MAX_MANUAL_TASKS_PER_RUN) {
          manualTasks.push({
            userId,
            ticker,
            candidateId: candId,
            entityLegalName: acc.displayName,
            stateAbbr: st,
            countyName: countyHint,
            reasonManual: `County-level recorder/clerk search (${countyHint} County, ${st}) for NFTL / state lien recordings.`,
            searchUrl: url || "(locate county recorder land records index)",
            exactSearchQuery: variants[0] ?? acc.displayName,
            suggestedDocTypeFiltersJson: { countyRecorder: COUNTY_RECORDER_DOC_TYPES } as unknown as Prisma.InputJsonValue,
            taskStatus: "open",
          });
        }
      }
    }

    if (manualTasks.length) {
      await tx.taxLienManualSearchTask.createMany({ data: manualTasks });
    }

    const stamp = new Date().toISOString();
    for (let i = 0; i < saved.length; i += ENTITY_UNIVERSE_STAMP_CHUNK) {
      const chunk = saved.slice(i, i + ENTITY_UNIVERSE_STAMP_CHUNK);
      await Promise.all(
        chunk.map((row) => {
          const j = row.searchJurisdictionsJson;
          const states = Array.isArray(j) ? j : [];
          return tx.entityUniverseItem.updateMany({
            where: { userId, ticker, normalizedEntityName: row.normalizedEntityName },
            data: {
              taxLienSummaryJson: {
                workflowUpdatedAt: stamp,
                searchJurisdictions: states,
                manualQueue: true,
                workflowSearchStatus: "manual_queue",
                disclaimer: "Tax lien workflow — research tool only, not legal advice.",
              } as unknown as Prisma.InputJsonValue,
            },
          });
        })
      );
    }
    },
    {
      maxWait: 20_000,
      timeout: TAX_LIEN_TX_TIMEOUT_MS,
    }
  );

  return {
    ok: true,
    candidatesCreated: candidateRows.length,
    manualTasksCreated: manualTasks.length,
    mergedEntities: merged.size,
    tasksCapped,
  };
}
