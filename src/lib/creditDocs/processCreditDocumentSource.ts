import type { PrismaClient } from "@/generated/prisma/client";
import type { CreditDocWorkflowEntityRole } from "@/generated/prisma/client";
import type { EntityUniverseItemRole } from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { parseCreditDocumentToPlainText } from "@/lib/creditDocs/parseCreditDocument";
import type { ExtractedDraft } from "@/lib/creditDocs/extractCreditDocEntities";
import { extractCreditDocEntities } from "@/lib/creditDocs/extractCreditDocEntities";
import {
  classifyRoleFromScheduleTitle,
  classifyRoleFromSignatureContext,
} from "@/lib/creditDocs/classifyCreditDocEntityRoles";
import type { CreditDocExtractionConfidence } from "@/generated/prisma/client";
import { reconciliationContext } from "@/lib/creditDocs/reconcileCreditDocEntities";
import { scoreFromRoles } from "@/lib/creditDocs/scoreCreditDocEntityRelevance";
import { getCreditAgreementsFileBuffer } from "@/lib/credit-agreements-files";
import { downloadAndExtractSecDocument } from "@/lib/debt-map/documentFetch";

function mapToUniverseRole(role: CreditDocWorkflowEntityRole): EntityUniverseItemRole | null {
  const table: Partial<Record<CreditDocWorkflowEntityRole, EntityUniverseItemRole>> = {
    borrower: "borrower",
    issuer: "issuer",
    co_issuer: "co_issuer",
    guarantor: "guarantor",
    subsidiary_guarantor: "guarantor",
    parent_guarantor: "guarantor",
    grantor: "grantor",
    pledgor: "pledgor",
    collateral_owner: "collateral_owner",
    loan_party: "possible_affiliate",
    obligor: "possible_affiliate",
    restricted_subsidiary: "restricted_subsidiary",
    unrestricted_subsidiary: "unrestricted_subsidiary",
    excluded_subsidiary: "excluded_subsidiary",
    immaterial_subsidiary: "immaterial_subsidiary",
    non_guarantor_subsidiary: "non_guarantor_subsidiary",
    restricted_non_guarantor_subsidiary: "non_guarantor_subsidiary",
    foreign_subsidiary: "possible_affiliate",
    domestic_subsidiary: "possible_affiliate",
    receivables_subsidiary: "receivables_sub",
    securitization_subsidiary: "securitization_vehicle",
    finance_subsidiary: "finance_sub",
    insurance_subsidiary: "possible_affiliate",
    captive_insurance_subsidiary: "possible_affiliate",
    subsidiary: "restricted_subsidiary",
    operating_company: "operating_company",
    holding_company: "holding_company",
    parent: "public_parent",
  };
  return table[role] ?? null;
}

function extractionConfidence(role: CreditDocWorkflowEntityRole, method: string): CreditDocExtractionConfidence {
  if (role === "unknown") return "low";
  if (method === "signature_page_extraction") return "high";
  if (method === "schedule_extraction") return role === "subsidiary" ? "medium" : "high";
  if (method === "table_extraction") return "medium";
  if (method === "manual") return "high";
  if (method === "llm") return "medium";
  return "medium";
}

function resolveDraftRole(d: ExtractedDraft): CreditDocWorkflowEntityRole {
  if (d.entityRole !== "subsidiary") return d.entityRole;
  const title = (d.sourceSchedule ?? "").trim();
  if (!title) return "subsidiary";
  const inferred = classifyRoleFromScheduleTitle(title);
  return inferred.role ?? "subsidiary";
}

function roleConfidenceFromDraft(d: ExtractedDraft, role: CreditDocWorkflowEntityRole): CreditDocExtractionConfidence {
  if (d.extractionMethod === "signature_page_extraction") {
    const fromSig = classifyRoleFromSignatureContext(d.rawContext ?? d.excerpt);
    return fromSig.confidence;
  }
  const sched = (d.sourceSchedule ?? "").trim();
  if (d.entityRole === "subsidiary" && sched.length > 0) {
    const inferred = classifyRoleFromScheduleTitle(sched);
    if (inferred.role) return inferred.confidence;
  }
  return extractionConfidence(role, d.extractionMethod);
}

/** Run heuristic extractor for one saved {@link CreditDocumentSource}. */
export async function processCreditDocumentSource(
  prisma: PrismaClient,
  opts: { userId: string; ticker: string; documentId: string }
): Promise<{ extractionsCreated: number; plainTextChars: number; status: "extraction_complete" | "extraction_failed" }> {
  const source = await prisma.creditDocumentSource.findFirst({
    where: { id: opts.documentId, userId: opts.userId, ticker: opts.ticker },
  });
  if (!source) throw new Error("Document not found");

  let extractedText = "";
  const ref = source.savedDocumentRefId;
  if (ref?.startsWith("user_saved:")) {
    const id = ref.split(":")[1]!;
    const doc = await prisma.userSavedDocument.findFirst({ where: { id, userId: opts.userId, ticker: opts.ticker } });
    if (doc) extractedText = parseCreditDocumentToPlainText(Buffer.from(doc.body));
  } else if (ref?.startsWith("public_records:")) {
    const id = ref.split(":")[1]!;
    const doc = await prisma.publicRecordsDocument.findFirst({ where: { id, userId: opts.userId, ticker: opts.ticker } });
    if (doc) {
      extractedText =
        doc.extractedText && doc.extractedText.length > 0
          ? doc.extractedText.slice(0, 1_200_000)
          : parseCreditDocumentToPlainText(Buffer.from(doc.body));
    }
  } else if (ref?.startsWith("credit_workspace:")) {
    const filename = ref.slice("credit_workspace:".length).trim();
    if (filename) {
      const found = await getCreditAgreementsFileBuffer(opts.userId, opts.ticker, filename);
      if (found?.buf?.length) extractedText = parseCreditDocumentToPlainText(found.buf);
    }
  }

  const secPick = source.secUrl?.trim() || source.sourceUrl?.trim();
  if (!extractedText.trim() && secPick?.startsWith("https://www.sec.gov/")) {
    const fetched = await downloadAndExtractSecDocument(secPick);
    extractedText = fetched.text ?? "";
  }

  const plainLen = extractedText.trim().length;
  if (!plainLen) {
    await prisma.creditDocumentSource.update({
      where: { id: source.id },
      data: { processingStatus: "extraction_failed", processed: false },
    });
    return { extractionsCreated: 0, plainTextChars: 0, status: "extraction_failed" };
  }

  const drafts = extractCreditDocEntities(extractedText, source.documentTitle);
  const recon = await reconciliationContext(prisma, opts.userId, opts.ticker);

  await prisma.creditDocumentEntityExtraction.deleteMany({
    where: { creditDocumentSourceId: source.id },
  });

  let n = 0;
  for (const d of drafts) {
    const { normalized } = normalizeEntityName(d.entityName);
    const role = resolveDraftRole(d);
    const cf = roleConfidenceFromDraft(d, role);
    const listed = recon.exhibit21Norms.has(normalized);
    const inUni = recon.universeNorms.has(normalized);
    const { score } = scoreFromRoles({
      roles: [role],
      notInEx21: !listed,
      docCountBoost: false,
    });
    await prisma.creditDocumentEntityExtraction.create({
      data: {
        userId: opts.userId,
        ticker: opts.ticker,
        creditDocumentSourceId: source.id,
        entityName: d.entityName.trim(),
        normalizedEntityName: normalized,
        entityRole: role,
        roleConfidence: cf,
        sourceSection: d.sourceSection ?? null,
        sourceSchedule: d.sourceSchedule ?? null,
        excerpt: d.excerpt,
        extractionMethod: d.extractionMethod,
        listedInExhibit21: listed,
        alreadyInEntityUniverse: inUni,
        recommendedEntityUniverseRole: mapToUniverseRole(role),
        relevanceScore: score,
      },
    });
    n++;
  }

  await prisma.creditDocumentSource.update({
    where: { id: source.id },
    data: {
      processed: true,
      processingStatus: "extraction_complete",
      extractedTextDigest: `len:${plainLen}`,
    },
  });

  return { extractionsCreated: n, plainTextChars: plainLen, status: "extraction_complete" };
}
