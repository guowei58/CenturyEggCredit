import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";
import { buildJurisdictionSearchPlan, type IntelFootprint } from "@/lib/ucc/jurisdictionPlan";
import { mergeUccSearchResultsIntoEntityMapperSnapshot } from "@/lib/ucc/mergeEntityMapperFromUcc";
import { debtorSearchVariants } from "@/lib/ucc/nameVariants";
import {
  automationBucketLetter,
  getStateCapability,
  portalUrlForCapability,
  recommendedSearchMethodLabel,
  resolveEntityWorkflowSearchStatus,
  UNKNOWN_JURISDICTION_CODE,
  type StateCapabilityRecord,
} from "@/lib/ucc/stateCapabilityRegistry";
import { usStateAbbrFromText } from "@/lib/usStates";
import { requireUserTicker } from "../_helpers";
import type { EntityUniverseConfidenceKind, Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MANUAL_TASKS_PER_RUN = 400;

function stateKey(s: string | null | undefined): string {
  return usStateAbbrFromText(s) ?? "";
}

type ClientSubsidiariesBody = {
  subsidiaryExhibit21Snapshot?: unknown;
  subsidiaryNames?: string[];
  subsidiaryDomiciles?: string[];
};

type ParsedRunBody = {
  publicRecordsSubsidiaries: ClientSubsidiariesBody | null;
  nationalSweep: boolean;
  broadNameFamily: boolean;
};

async function parseRunBody(req: Request): Promise<ParsedRunBody> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json"))
    return { publicRecordsSubsidiaries: null, nationalSweep: false, broadNameFamily: false };
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object")
    return { publicRecordsSubsidiaries: null, nationalSweep: false, broadNameFamily: false };
  const o = raw as Record<string, unknown>;
  const nationalSweep = o.nationalSweep === true;
  const broadNameFamily = o.broadNameFamily === true;
  const prs = o.publicRecordsSubsidiaries;
  if (!prs || typeof prs !== "object")
    return { publicRecordsSubsidiaries: null, nationalSweep, broadNameFamily };
  const p = prs as Record<string, unknown>;
  const names = p.subsidiaryNames;
  const doms = p.subsidiaryDomiciles;
  return {
    nationalSweep,
    broadNameFamily,
    publicRecordsSubsidiaries: {
      subsidiaryExhibit21Snapshot: p.subsidiaryExhibit21Snapshot,
      subsidiaryNames: Array.isArray(names) ? names.map((x) => String(x ?? "")) : undefined,
      subsidiaryDomiciles: Array.isArray(doms) ? doms.map((x) => String(x ?? "")) : undefined,
    },
  };
}

function planConfidenceToEnum(level: "High" | "Medium" | "Low"): EntityUniverseConfidenceKind {
  if (level === "High") return "high";
  if (level === "Medium") return "medium";
  return "low";
}

function classifyJurisdictionConfidence(
  formationAbbr: string | null,
  primaryState: string
): "exact" | "inferred" | "unknown" {
  if (primaryState === UNKNOWN_JURISDICTION_CODE) return "unknown";
  if (formationAbbr && /^[A-Z]{2}$/.test(formationAbbr)) return "exact";
  return "inferred";
}

function reasonForManualTask(cap: StateCapabilityRecord, stateCode: string): string {
  const letter = automationBucketLetter(cap.bucket);
  if (stateCode === UNKNOWN_JURISDICTION_CODE) {
    return "Unknown jurisdiction bucket — resolve charter / SOS / credit-agreement foot-print before UCC search.";
  }
  if (cap.bucket === "manual_authorized_searcher") {
    return `Manual / authorized-searcher workflow. ${cap.notes}`;
  }
  if (letter === "A") {
    return `Bulk/API adapter not configured or subscription missing. ${cap.notes}`;
  }
  if (letter === "B") {
    return `Portal automation disabled pending adapter + terms review (CAPTCHA/login/evasion prohibited). ${cap.notes}`;
  }
  return `Adapter not configured — queued as manual diligence. ${cap.notes}`;
}

function instructionsForManual(cap: StateCapabilityRecord, st: string, entityName: string, variants: string[]): string {
  if (st === "DE") {
    return [
      "Delaware UCC debtor search typically requires an authorized searcher / certified search order.",
      `Debtor queries (tight → broad): ${variants.slice(0, 6).join(" → ") || entityName}.`,
      "Upload certified results when received — search cannot be marked complete until reviewed.",
      "Do not scrape SOS/UCC sites.",
    ].join(" ");
  }
  if (st === UNKNOWN_JURISDICTION_CODE) {
    return [
      "Resolve formation jurisdiction via Exhibit 21, SOS charter lookup, credit agreement collateral annexes, or perfection certificates.",
      "Once formation is known, re-run this workflow or shift the entity into the proper state queue.",
    ].join(" ");
  }
  return [
    `Use the official UCC debtor search for ${st} (${cap.state_name}).`,
    `Try queries in order: ${variants.slice(0, 6).join(" → ") || entityName}.`,
    "Record debtor name as filed, secured party, filing number/type, dates, active vs lapsed/terminated, collateral summary, document links.",
    "Stop immediately if CAPTCHA, mandatory login, or subscription gates appear.",
  ].join(" ");
}

type MergedAcc = {
  norm: string;
  formationAbbr: string | null;
  formationRaw: string | null;
  displayName: string;
  sources: Set<string>;
  listedEx21: boolean;
  creditDocs: boolean;
};

function mergeEntityKey(norm: string, formationAbbr: string | null): string {
  return `${norm}|${formationAbbr ?? "NA"}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker: raw } = await params;
    const ctx = await requireUserTicker(raw);
    if ("error" in ctx) return ctx.error;
    const { userId, ticker } = ctx;

    const body = await parseRunBody(req);

    const [ex21, sos, addr, userAdded, publicRecordsProf, intelProfile] = await Promise.all([
      prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }).catch(() => []),
      prisma.sosNameFamilyCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }).catch(() => []),
      prisma.addressClusterCandidate.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } }).catch(() => []),
      prisma.entityUniverseItem
        .findMany({
          where: { userId, ticker, primarySourceCategory: "user_added" },
          orderBy: { updatedAt: "desc" },
        })
        .catch(() => []),
      prisma.publicRecordsProfile.findUnique({ where: { userId_ticker: { userId, ticker } } }).catch(() => null),
      prisma.entityIntelligenceProfile.findFirst({ where: { userId, ticker } }).catch(() => null),
    ]);

    const profileSubsidiaryRowsFromDb =
      publicRecordsProf != null
        ? subsidiaryTableRowsFromSavedProfile(
            publicRecordsProf.subsidiaryExhibit21Snapshot,
            publicRecordsProf.subsidiaryNames,
            publicRecordsProf.subsidiaryDomiciles
          )
        : [];

    const profileSubsidiaryRowsFromClient = body.publicRecordsSubsidiaries
      ? subsidiaryTableRowsFromSavedProfile(
          body.publicRecordsSubsidiaries.subsidiaryExhibit21Snapshot,
          body.publicRecordsSubsidiaries.subsidiaryNames,
          body.publicRecordsSubsidiaries.subsidiaryDomiciles
        )
      : [];

    const profileSubsidiaryRows =
      profileSubsidiaryRowsFromClient.length > 0 ? profileSubsidiaryRowsFromClient : profileSubsidiaryRowsFromDb;

    const intel: IntelFootprint | null = intelProfile
      ? {
          hqState: stateKey(intelProfile.hqState) || null,
          stateOfIncorporation: stateKey(intelProfile.stateOfIncorporation) || null,
          majorOperatingStates: (intelProfile.majorOperatingStates ?? []).map((s) => stateKey(s)).filter(Boolean),
        }
      : null;

    const addrStatesByNorm = new Map<string, string[]>();
    for (const r of addr) {
      const nk = normalizeEntityName(r.candidateEntityName).normalized;
      const st = stateKey(r.state);
      if (!nk || !st) continue;
      const arr = addrStatesByNorm.get(nk) ?? [];
      if (!arr.includes(st)) arr.push(st);
      addrStatesByNorm.set(nk, arr);
    }

    const merged = new Map<string, MergedAcc>();

    function touch(
      exactName: string,
      formationRaw: string | null | undefined,
      tag: string,
      opts: { listedEx21: boolean; creditDocs: boolean }
    ) {
      const trimmed = exactName.replace(/\s+/g, " ").trim();
      if (!trimmed) return;
      const norm = normalizeEntityName(trimmed).normalized;
      if (!norm) return;
      const fabbr = stateKey(formationRaw ?? "") || null;
      const key = mergeEntityKey(norm, fabbr);
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, {
          norm,
          formationAbbr: fabbr,
          formationRaw: formationRaw?.trim() ? formationRaw.trim() : null,
          displayName: trimmed,
          sources: new Set([tag]),
          listedEx21: opts.listedEx21,
          creditDocs: opts.creditDocs,
        });
        return;
      }
      prev.sources.add(tag);
      prev.listedEx21 = prev.listedEx21 || opts.listedEx21;
      prev.creditDocs = prev.creditDocs || opts.creditDocs;
      if (trimmed.length > prev.displayName.length) prev.displayName = trimmed;
      if (!prev.formationRaw && formationRaw?.trim()) prev.formationRaw = formationRaw.trim();
      if (!prev.formationAbbr && fabbr) prev.formationAbbr = fabbr;
    }

    for (const row of profileSubsidiaryRows) {
      touch(row.name, row.domicile || null, "exhibit21_profile", { listedEx21: true, creditDocs: false });
    }
    for (const r of ex21) touch(r.entityName, r.jurisdiction, "exhibit21_synced", { listedEx21: true, creditDocs: false });
    for (const r of sos)
      touch(r.candidateEntityName, r.state, "sos_name_family", { listedEx21: false, creditDocs: false });
    for (const r of addr)
      touch(r.candidateEntityName, r.state, "address_cluster", { listedEx21: false, creditDocs: false });
    for (const r of userAdded)
      touch(r.entityName, r.state || r.jurisdiction || null, "user_added", { listedEx21: false, creditDocs: false });

    let unknownJurisdictionEntities = 0;
    const candidateCreates: Prisma.UccDebtorCandidateCreateManyInput[] = [];
    let tasksCapped = false;
    let manualTasksCreated = 0;

    for (const acc of merged.values()) {
      const variants = debtorSearchVariants(acc.displayName, { broadNameFamily: body.broadNameFamily }).slice(0, 30);
      if (variants.length === 0) continue;

      const extraStates = addrStatesByNorm.get(acc.norm) ?? [];

      const plan = buildJurisdictionSearchPlan({
        entityExactName: acc.displayName,
        formationAbbr: acc.formationAbbr,
        formationRaw: acc.formationRaw,
        intel,
        extraStatesFromAddresses: extraStates,
        nationalSweep: body.nationalSweep,
      });

      if (plan.primary_jurisdiction === UNKNOWN_JURISDICTION_CODE) unknownJurisdictionEntities++;

      const primaryCap = getStateCapability(plan.primary_jurisdiction);
      const jcKind = classifyJurisdictionConfidence(acc.formationAbbr, plan.primary_jurisdiction);
      const workflowLabel = resolveEntityWorkflowSearchStatus(primaryCap);

      candidateCreates.push({
        userId,
        ticker,
        debtorName: acc.displayName,
        normalizedDebtorName: acc.norm,
        state: plan.primary_jurisdiction,
        sourceName: `UCC debtor workflow (${[...acc.sources].sort().join("; ")})`,
        sourceUrl: portalUrlForCapability(primaryCap),
        filingNumber: null,
        filingDate: null,
        securedPartyName: null,
        collateralDescription: null,
        filingType: "unknown",
        matchedSearchTerm: variants[0],
        listedInExhibit21: acc.listedEx21,
        appearsInCreditDocs: acc.creditDocs,
        confidence: planConfidenceToEnum(plan.confidence),
        relevanceScore: 0,
        reviewStatus: "unreviewed",
        workflowEntitySources: [...acc.sources].sort().join(";"),
        jurisdictionFormationRaw: acc.formationRaw,
        secondaryStates: plan.secondary_jurisdictions,
        queryVariantsJson: variants,
        jurisdictionPlanJson: plan as unknown as Prisma.InputJsonValue,
        workflowSearchStatus: workflowLabel,
        workflowHitCount: 0,
        automationBucket: primaryCap.bucket,
        jurisdictionConfidenceKind: jcKind,
        recommendedSearchMethod: recommendedSearchMethodLabel(primaryCap),
        notes: [
          plan.reason,
          `Automation bucket ${automationBucketLetter(primaryCap.bucket)} (${primaryCap.bucket}).`,
          primaryCap.notes,
          "UCC debtor ≠ borrower/guarantor — map only collateral/grantor hypotheses with corroborating credit docs.",
        ].join(" "),
      });
    }

    const cappedCandidates =
      candidateCreates.length > 3500 ? candidateCreates.slice(0, 3500) : candidateCreates;

    await prisma.$transaction(async (tx) => {
      await tx.uccCreditDocumentMatch.deleteMany({ where: { userId, ticker } });
      await tx.uccDiscoveredEntityCandidate.deleteMany({ where: { userId, ticker } });
      await tx.uccSearchResult.deleteMany({ where: { userId, ticker } });
      await tx.uccManualSearchTask.deleteMany({ where: { userId, ticker } });
      await tx.uccDebtorCandidate.deleteMany({ where: { userId, ticker } });

      if (cappedCandidates.length) {
        await tx.uccDebtorCandidate.createMany({ data: cappedCandidates });
      }

      const savedCandidates = await tx.uccDebtorCandidate.findMany({
        where: { userId, ticker },
        select: { id: true, normalizedDebtorName: true, state: true },
      });

      const idByNormState = new Map(savedCandidates.map((r) => [`${r.normalizedDebtorName}|${r.state}`, r.id]));

      const manualBatch: Prisma.UccManualSearchTaskCreateManyInput[] = [];

      outer: for (const row of cappedCandidates) {
        const candId = idByNormState.get(`${row.normalizedDebtorName}|${row.state}`);
        if (!candId) continue;
        const variants = (row.queryVariantsJson as string[]) ?? [];
        const secondary = (row.secondaryStates as string[]) ?? [];
        const primaryState = row.state;
        const states =
          primaryState === UNKNOWN_JURISDICTION_CODE ? [UNKNOWN_JURISDICTION_CODE] : [primaryState, ...secondary];

        const seenSt = new Set<string>();
        for (const st of states) {
          if (!st || seenSt.has(st)) continue;
          seenSt.add(st);
          const cap = getStateCapability(st);
          const portalUrl = portalUrlForCapability(cap);
          const wf = resolveEntityWorkflowSearchStatus(cap);

          if (manualBatch.length >= MAX_MANUAL_TASKS_PER_RUN) {
            tasksCapped = true;
            break outer;
          }

          manualBatch.push({
            userId,
            ticker,
            candidateId: candId,
            entityName: row.debtorName,
            jurisdiction: st,
            portalUrl,
            exactSearchQuery: variants[0] ?? row.debtorName,
            normalizedQueriesJson: variants.slice(0, 14),
            reasonManual: reasonForManualTask(cap, st),
            instructions: instructionsForManual(cap, st, row.debtorName, variants),
            taskStatus: "open",
            automationBucket: cap.bucket,
            workflowStatusLabel: wf,
            isDelawareAuthorizedSearcherTask: st === "DE",
          });
        }
      }

      const manualData = manualBatch.length > 8000 ? manualBatch.slice(0, 8000) : manualBatch;
      manualTasksCreated = manualData.length;

      if (manualData.length) {
        await tx.uccManualSearchTask.createMany({ data: manualData });
      }
    });

    const mapperMerge = await mergeUccSearchResultsIntoEntityMapperSnapshot(userId, ticker).catch(() => ({
      merged: 0,
      note: "merge_failed",
    }));

    return NextResponse.json({
      ok: true,
      wiped: true,
      candidatesCreated: cappedCandidates.length,
      manualTasksCreated,
      mergedEntities: merged.size,
      unknownJurisdictionEntities,
      tasksCapped,
      nationalSweep: body.nationalSweep,
      broadNameFamily: body.broadNameFamily,
      entityMapperEvidenceMerged: mapperMerge.merged,
      entityMapperMergeNote: mapperMerge.note,
      message:
        cappedCandidates.length === 0
          ? "No UCC workflow candidates produced."
          : `Queued ${cappedCandidates.length} entity workflow rows, ${manualTasksCreated} manual/search tasks, and refreshed automation buckets per state registry.`,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "UCC run failed.";
    const msg = raw.includes("does not exist in the current database")
      ? `Database schema is missing required tables (migrations not applied). Run \`prisma migrate deploy\` on the deployed DB, then retry. Details: ${raw}`
      : raw;
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
