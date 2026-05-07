import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { syncExhibit21SubsidiariesFromPublicProfile } from "@/lib/syncExhibit21FromPublicProfile";
import { processCreditDocumentSource } from "@/lib/creditDocs/processCreditDocumentSource";
import { rebuildCreditDocEntityRoleMatrixForTicker } from "@/lib/creditDocs/rebuildCreditDocEntityRoleMatrix";
import { findCreditDocumentsInDb } from "@/lib/creditDocs/findCreditDocuments";
import {
  findEdgarDebtDocSearchWithReport,
  mergeCreditFinderCandidates,
} from "@/lib/creditDocs/findEdgarCreditDocuments";
import { serEntityUniverseRow } from "../_helpers";
import type { RoleFlagTriState } from "@/lib/creditDocs/matrixRoleKeys";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RunBody = {
  /** If true, run EDGAR scan to locate candidate credit documents (best-effort). */
  discoverDocuments?: boolean;
  /** If true, queue newly discovered EDGAR/saved docs into CreditDocumentSource. */
  autoQueue?: boolean;
  /** If true, process all queued documents (extract entities). */
  extractEntities?: boolean;
  /** Cap processing to avoid timeouts. */
  maxDocumentsToProcess?: number;
};

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function num(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

function safeJson(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function roleSummaryFromFlags(flags: Record<string, RoleFlagTriState | string>): string[] {
  const wanted: Array<[keyof typeof flags, string]> = [
    ["borrower", "Borrower"],
    ["issuer", "Issuer"],
    ["coIssuer", "Co-issuer"],
    ["guarantor", "Guarantor"],
    ["grantor", "Grantor"],
    ["pledgor", "Pledgor"],
    ["restrictedSubsidiary", "Restricted sub"],
    ["unrestrictedSubsidiary", "Unrestricted sub"],
    ["excludedSubsidiary", "Excluded sub"],
    ["receivablesSubsidiary", "Receivables sub"],
    ["securitizationSubsidiary", "Securitization sub"],
    ["financeSubsidiary", "Finance sub"],
  ];
  const out: string[] = [];
  for (const [k, label] of wanted) {
    const v = String(flags[k] ?? "");
    if (v === "true") out.push(label);
    else if (v === "needs_review") out.push(`${label} (?)`);
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const bodyRaw = await req.json().catch(() => ({}));
  const body = safeJson(bodyRaw) as RunBody;
  const discoverDocuments = bool(body.discoverDocuments, true);
  const autoQueue = bool(body.autoQueue, false);
  const extractEntities = bool(body.extractEntities, true);
  const maxDocumentsToProcess = Math.max(1, Math.min(60, Math.floor(num(body.maxDocumentsToProcess, 24))));

  // Keep Exhibit 21 synced so matching is conservative + current.
  try {
    await syncExhibit21SubsidiariesFromPublicProfile(prisma, ctx.userId, ctx.ticker);
  } catch {
    /* best-effort */
  }

  const [ex21, localDocs] = await Promise.all([
    prisma.exhibit21Subsidiary
      .findMany({ where: { userId: ctx.userId, ticker: ctx.ticker }, orderBy: { updatedAt: "desc" } })
      .catch(() => []),
    findCreditDocumentsInDb(prisma, { userId: ctx.userId, ticker: ctx.ticker }).catch(() => []),
  ]);

  let edgarWarning: string | null = null;
  let edgarDebtSearch: Record<string, unknown> | null = null;
  let discoveryCandidates: Array<Record<string, unknown>> = [];
  if (discoverDocuments) {
    try {
      const r = await findEdgarDebtDocSearchWithReport(ctx.ticker, { lookbackYears: 10 });
      discoveryCandidates = mergeCreditFinderCandidates(r.candidates, localDocs) as unknown as Array<Record<string, unknown>>;
      edgarDebtSearch = (r.search ?? null) as unknown as Record<string, unknown> | null;
    } catch (e) {
      edgarWarning = e instanceof Error ? e.message : "EDGAR scan failed.";
      discoveryCandidates = localDocs as unknown as Array<Record<string, unknown>>;
    }
  } else {
    discoveryCandidates = localDocs as unknown as Array<Record<string, unknown>>;
  }

  let queued = 0;
  if (autoQueue) {
    const existing = await prisma.creditDocumentSource
      .findMany({
        where: { userId: ctx.userId, ticker: ctx.ticker },
        select: { savedDocumentRefId: true, secUrl: true },
      })
      .catch(() => []);
    const existingKeys = new Set(
      existing
        .map((d) => (d.savedDocumentRefId ? `ref:${d.savedDocumentRefId}` : d.secUrl ? `sec:${d.secUrl}` : null))
        .filter(Boolean) as string[]
    );

    for (const c of discoveryCandidates.slice(0, 80)) {
      const documentTitle = typeof c.documentTitle === "string" ? c.documentTitle.trim() : "";
      if (!documentTitle) continue;
      const savedDocumentRefId = typeof c.savedDocumentRefId === "string" ? c.savedDocumentRefId.trim() : "";
      const openUrl = typeof c.openUrl === "string" ? c.openUrl.trim() : "";
      const secUrl = openUrl.startsWith("https://www.sec.gov/") ? openUrl : "";
      const key = savedDocumentRefId ? `ref:${savedDocumentRefId}` : secUrl ? `sec:${secUrl}` : "";
      if (!key || existingKeys.has(key)) continue;

      await prisma.creditDocumentSource.create({
        data: {
          userId: ctx.userId,
          ticker: ctx.ticker,
          documentTitle,
          documentType: (typeof c.documentType === "string" ? c.documentType : "other") as never,
          filingType: (typeof c.filingType === "string" ? c.filingType : "other") as never,
          sourceUrl: typeof c.sourceUrl === "string" ? c.sourceUrl : undefined,
          savedDocumentRefId: savedDocumentRefId || undefined,
          secUrl: secUrl || undefined,
          filingDate: typeof c.filingDate === "string" && c.filingDate ? new Date(c.filingDate) : undefined,
          processed: false,
          processingStatus: "not_started",
        },
      });
      existingKeys.add(key);
      queued++;
    }
  }

  const docs = await prisma.creditDocumentSource
    .findMany({
      where: { userId: ctx.userId, ticker: ctx.ticker },
      orderBy: [{ filingDate: "desc" }, { updatedAt: "desc" }],
    })
    .catch(() => []);

  const docsToProcess = extractEntities
    ? docs.filter((d) => d.processingStatus !== "extraction_complete").slice(0, maxDocumentsToProcess)
    : [];

  const processResults: Array<Record<string, unknown>> = [];
  for (const d of docsToProcess) {
    try {
      const r = await processCreditDocumentSource(prisma, {
        userId: ctx.userId,
        ticker: ctx.ticker,
        documentId: d.id,
      });
      processResults.push({ documentId: d.id, ok: true, ...r });
    } catch (e) {
      processResults.push({ documentId: d.id, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }

  // Build / refresh role matrix (source-backed tri-state role flags + key evidence).
  const matrixBuild = await rebuildCreditDocEntityRoleMatrixForTicker(prisma, {
    userId: ctx.userId,
    ticker: ctx.ticker,
  }).catch(() => ({ rowsUpserted: 0 }));

  const [matrix, issues, uccResults, uccDiscovered] = await Promise.all([
    prisma.creditDocumentEntityRoleMatrixRow
      .findMany({ where: { userId: ctx.userId, ticker: ctx.ticker }, orderBy: [{ relevanceScore: "desc" }, { updatedAt: "desc" }] })
      .catch(() => []),
    prisma.creditDocWorkflowIssue
      .findMany({ where: { userId: ctx.userId, ticker: ctx.ticker }, orderBy: [{ severity: "asc" }, { createdAt: "desc" }] })
      .catch(() => []),
    prisma.uccSearchResult
      .findMany({ where: { userId: ctx.userId, ticker: ctx.ticker }, orderBy: [{ updatedAt: "desc" }] })
      .catch(() => []),
    prisma.uccDiscoveredEntityCandidate
      .findMany({ where: { userId: ctx.userId, ticker: ctx.ticker }, orderBy: [{ createdAt: "desc" }] })
      .catch(() => []),
  ]);

  const exhibit21Norms = new Set(ex21.map((r) => r.normalizedEntityName));

  const creditCandidates = matrix
    .filter((r) => !r.listedInExhibit21)
    .slice(0, 400)
    .map((r) => {
      const flags = (r.roleFlagsJson as Record<string, RoleFlagTriState | string> | null) ?? {};
      const roles = roleSummaryFromFlags(flags);
      const highPriority = roles.some((x) =>
        /Borrower|Issuer|Co-issuer|Guarantor|Grantor|Pledgor|Receivables|Securitization|Finance/.test(x)
      );
      return {
        id: r.id,
        entityLegalName: r.entityName,
        normalizedName: r.normalizedEntityName,
        exhibit21MatchStatus: exhibit21Norms.has(r.normalizedEntityName) ? "On Exhibit 21 — normalized match" : "Not found on Exhibit 21",
        jurisdiction: r.jurisdiction || null,
        roleOrDesignation: roles.join(", ") || "Unknown / requires review",
        whyHighPriority: highPriority ? "Credit-role signal in matrix" : "",
        currentHistoricalUnclear: "unclear",
        discoverySource: "credit document",
        confidence: r.confidence,
        relevanceScore: r.relevanceScore,
        sourceDocumentTitles: r.sourceDocumentTitles,
        sectionReference: null,
        exactSourceQuote: r.keyEvidence ?? null,
      };
    });

  const uccCandidates = [
    ...uccDiscovered.map((r) => ({
      id: r.id,
      entityLegalName: r.newEntityName,
      normalizedName: "",
      exhibit21MatchStatus: "Ambiguous / requires review",
      jurisdiction: r.jurisdiction ?? null,
      roleOrDesignation: "UCC debtor (discovered) / requires review",
      whyHighPriority: "Appears in UCC workflow as net-new debtor name",
      currentHistoricalUnclear: "unclear",
      discoverySource: "UCC record",
      confidence: r.confidence,
      relevanceScore: 0,
      sourceDocumentTitles: null,
      sectionReference: `UCC filing ${r.filingNumber ?? "—"}`,
      exactSourceQuote: r.reasonFlagged,
    })),
    ...uccResults
      .filter((r) => r.debtorNameFound && !exhibit21Norms.has((r.debtorNameFound ?? "").toLowerCase()))
      .slice(0, 120)
      .map((r) => ({
        id: r.id,
        entityLegalName: r.debtorNameFound,
        normalizedName: "",
        exhibit21MatchStatus: "Ambiguous / requires review",
        jurisdiction: r.jurisdiction,
        roleOrDesignation: "UCC debtor / requires review",
        whyHighPriority: "Appears as debtor in UCC result",
        currentHistoricalUnclear: "unclear",
        discoverySource: "UCC record",
        confidence: r.confidence,
        relevanceScore: 0,
        sourceDocumentTitles: null,
        sectionReference: `UCC filing ${r.filingNumber ?? "—"} · filed ${r.filingDate ? r.filingDate.toISOString().slice(0, 10) : "—"}`,
        exactSourceQuote: r.collateralDescription ? r.collateralDescription.slice(0, 340) : null,
      })),
  ];

  return NextResponse.json({
    ok: true,
    ticker: ctx.ticker,
    executiveSummary: {
      exhibit21Subsidiaries: ex21.length,
      creditDocumentsQueued: docs.length,
      creditDocumentsProcessedThisRun: docsToProcess.length,
      creditDocumentsProcessedTotal: docs.filter((d) => d.processingStatus === "extraction_complete").length,
      creditEntityMatrixRows: matrix.length,
      creditCandidatesNotInEx21: creditCandidates.length,
      uccCandidatesNotInEx21: uccCandidates.length,
      issuesOpen: issues.filter((i) => i.status === "open").length,
    },
    edgar: {
      warning: edgarWarning,
      debtSearchReport: edgarDebtSearch,
      discoveryCandidatesCount: discoveryCandidates.length,
      autoQueued: queued,
    },
    credit: {
      documents: docs.map((d) => serEntityUniverseRow(d as unknown as Record<string, unknown>)),
      matrix: matrix.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
      issues: issues.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)),
      matrixBuild,
      processResults,
    },
    hiddenCandidates: {
      fromCreditDocuments: creditCandidates,
      fromUcc: uccCandidates,
      missingOrOmittedSchedulesWarnings: docs
        .filter((d) => d.processingStatus === "extraction_failed")
        .slice(0, 50)
        .map((d) => ({
          documentId: d.id,
          documentTitle: d.documentTitle,
          warning: "Could not extract text/entities — document may be missing, redacted, or not accessible in this environment.",
        })),
    },
  });
}

