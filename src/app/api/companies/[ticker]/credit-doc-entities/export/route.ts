import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { CREDIT_MATRIX_ROLE_KEYS } from "@/lib/creditDocs/matrixRoleKeys";
import type { RoleFlagTriState } from "@/lib/creditDocs/matrixRoleKeys";

export const dynamic = "force-dynamic";

function csvEscape(s: string): string {
  const t = String(s ?? "");
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function triCsv(v: string | undefined): string {
  const x = v ?? "";
  return x === "true" ? "true" : x === "false" ? "false" : x === "unknown" ? "unknown" : x === "needs_review" ? "needs_review" : "";
}

const PARTY_KEYS = [
  "borrower",
  "issuer",
  "coIssuer",
  "guarantor",
  "grantor",
  "pledgor",
  "collateralOwner",
] as const;

/** POST returns bundled strings for markdown memo and CSV payloads. */
export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const docs = await prisma.creditDocumentSource.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ filingDate: "desc" }, { updatedAt: "desc" }],
  });
  const extractions = await prisma.creditDocumentEntityExtraction.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ updatedAt: "desc" }],
  });
  const docTitleById = Object.fromEntries(docs.map((d) => [d.id, d.documentTitle]));
  const matrix = await prisma.creditDocumentEntityRoleMatrixRow.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ relevanceScore: "desc" }],
  });
  const issues = await prisma.creditDocWorkflowIssue.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
  });

  const docListCsv = [
    [
      "document title",
      "document type",
      "filing date",
      "exhibit",
      "source url",
      "processed",
      "processing status",
      "notes",
    ]
      .map(csvEscape)
      .join(","),
    ...docs.map((d) =>
      [
        d.documentTitle,
        d.documentType,
        d.filingDate ? d.filingDate.toISOString().slice(0, 10) : "",
        d.exhibitNumber ?? "",
        d.sourceUrl ?? d.secUrl ?? "",
        String(d.processed),
        d.processingStatus,
        d.notes ?? "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");

  const extractionCsv = [
    [
      "entity name",
      "role",
      "document title",
      "section",
      "schedule",
      "page",
      "excerpt",
      "listed ex21",
      "in universe",
      "relevance",
      "confidence",
      "review",
      "notes",
    ]
      .map(csvEscape)
      .join(","),
    ...extractions.map((e) =>
      [
        e.entityName,
        e.entityRole,
        docTitleById[e.creditDocumentSourceId] ?? "",
        e.sourceSection ?? "",
        e.sourceSchedule ?? "",
        e.pageNumber ?? "",
        (e.excerpt ?? "").replace(/\s+/g, " ").slice(0, 500),
        String(e.listedInExhibit21),
        String(e.alreadyInEntityUniverse),
        String(e.relevanceScore),
        e.roleConfidence,
        e.reviewStatus,
        e.notes ?? "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");

  const matrixHeader = [
    "entityName",
    "normalizedEntityName",
    "state",
    "jurisdiction",
    "listedInExhibit21",
    "inUniverse",
    "relevance",
    "confidence",
    "reviewStatus",
    ...CREDIT_MATRIX_ROLE_KEYS,
  ];

  const matrixCsv = [
    matrixHeader.map(csvEscape).join(","),
    ...matrix.map((r) => {
      const rf = r.roleFlagsJson as Record<string, RoleFlagTriState | string>;
      const roleCells = CREDIT_MATRIX_ROLE_KEYS.map((k) => csvEscape(triCsv(String(rf[k] ?? ""))));
      const base = [
        r.entityName,
        r.normalizedEntityName,
        r.state,
        r.jurisdiction,
        String(r.listedInExhibit21),
        String(r.alreadyInEntityUniverse),
        String(r.relevanceScore),
        r.confidence,
        r.reviewStatus,
      ].map(csvEscape);
      return [...base, ...roleCells].join(",");
    }),
  ].join("\n");

  const bifMapCsv = [
    ["entity", ...PARTY_KEYS, "key evidence"].map(csvEscape).join(","),
    ...matrix
      .map((r) => {
        const rf = r.roleFlagsJson as Record<string, RoleFlagTriState | string>;
        const hasParty = PARTY_KEYS.some((k) => rf[k] && rf[k] !== "false");
        if (!hasParty) return null;
        const cells = PARTY_KEYS.map((k) => triCsv(String(rf[k])));
        return [r.entityName, ...cells, r.keyEvidence ?? ""].map(csvEscape).join(",");
      })
      .filter(Boolean) as string[],
  ].join("\n");

  const subsidiaryCsvHeader = [
    "entity",
    "restrictedSubsidiary",
    "unrestrictedSubsidiary",
    "excludedSubsidiary",
    "immaterialSubsidiary",
    "nonGuarantorSubsidiary",
    "restrictedNonGuarantorSubsidiary",
    "listedEx21",
    "relevance",
    "confidence",
    "notes",
  ];

  const subCsv = [
    subsidiaryCsvHeader.map(csvEscape).join(","),
    ...matrix.map((r) => {
      const rf = r.roleFlagsJson as Record<string, RoleFlagTriState | string>;
      return [
        r.entityName,
        triCsv(String(rf.restrictedSubsidiary)),
        triCsv(String(rf.unrestrictedSubsidiary)),
        triCsv(String(rf.excludedSubsidiary)),
        triCsv(String(rf.immaterialSubsidiary)),
        triCsv(String(rf.nonGuarantorSubsidiary)),
        triCsv(String(rf.restrictedNonGuarantorSubsidiary)),
        String(r.listedInExhibit21),
        String(r.relevanceScore),
        r.confidence,
        r.notes ?? "",
      ]
        .map(csvEscape)
        .join(",");
    }),
  ].join("\n");

  const memo = [
    `# Credit document entity workflow — ${ctx.ticker}`,
    "",
    "## Executive summary",
    `Processed documents: ${docs.filter((d) => d.processed).length}/${docs.length}. Matrix rows: ${matrix.length}. Open issues: ${issues.filter((i) => i.status === "open").length}.`,
    "",
    "## Credit documents reviewed",
    ...docs.slice(0, 40).map((d) => `- ${d.documentTitle} (${d.processingStatus})`),
    docs.length > 40 ? `\n…and ${docs.length - 40} more.` : "",
    "",
    "## Entities not indicated on Exhibit 21 (flag)",
    ...matrix
      .filter((r) => !r.listedInExhibit21)
      .slice(0, 30)
      .map((r) => `- ${r.entityName}${r.keyEvidence ? ` — _${String(r.keyEvidence).slice(0, 140)}…_` : ""}`),
    "",
    "## Open workflow issues",
    ...issues.filter((i) => i.status === "open").map((i) => `### (${i.severity}) ${i.issueTitle}\n${i.issueDescription}\n`),
  ].join("\n");

  return NextResponse.json({
    ticker: ctx.ticker,
    creditDocumentListCsv: docListCsv,
    extractionTableCsv: extractionCsv,
    entityRoleMatrixCsv: matrixCsv,
    borrowerIssuerGuarantorMapCsv: bifMapCsv,
    subsidiaryClassificationCsv: subCsv,
    issuesMemoMarkdown: memo,
    raw: {
      documents: docs.length,
      extractions: extractions.length,
      matrixRows: matrix.length,
      issues: issues.length,
    },
  });
}
