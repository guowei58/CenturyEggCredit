import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { findCreditDocumentsInDb } from "@/lib/creditDocs/findCreditDocuments";
import { findEdgarDebtDocSearchWithReport, mergeCreditFinderCandidates } from "@/lib/creditDocs/findEdgarCreditDocuments";
import { inferCreditDocumentTitleType } from "@/lib/creditDocs/findCreditDocuments";
import { processCreditDocumentSource } from "@/lib/creditDocs/processCreditDocumentSource";
import { rebuildCreditDocEntityRoleMatrixForTicker } from "@/lib/creditDocs/rebuildCreditDocEntityRoleMatrix";
import { parseCreditDocumentToPlainText } from "@/lib/creditDocs/parseCreditDocument";
import { getCreditAgreementsFileBuffer } from "@/lib/credit-agreements-files";
import { downloadAndExtractSecDocument } from "@/lib/debt-map/documentFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AutoRunBody = {
  lookbackYears?: number;
  maxDocumentsToQueue?: number;
  maxDocumentsToProcess?: number;
};

function safeNum(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const body = (await req.json().catch(() => ({}))) as AutoRunBody;
  const lookbackYears = clampInt(safeNum(body.lookbackYears, 10), 1, 40);
  const maxDocumentsToQueue = clampInt(safeNum(body.maxDocumentsToQueue, 80), 1, 200);
  const maxDocumentsToProcess = clampInt(safeNum(body.maxDocumentsToProcess, 24), 1, 80);

  const local = await findCreditDocumentsInDb(prisma, { userId, ticker }).catch(() => []);

  let edgarWarning: string | null = null;
  let edgarDebtSearch: Record<string, unknown> | null = null;
  let candidates: Array<Record<string, unknown>> = [];
  try {
    const r = await findEdgarDebtDocSearchWithReport(ticker, { lookbackYears });
    candidates = mergeCreditFinderCandidates(r.candidates, local) as unknown as Array<Record<string, unknown>>;
    edgarDebtSearch = (r.search ?? null) as unknown as Record<string, unknown> | null;
  } catch (e) {
    edgarWarning = e instanceof Error ? e.message : "EDGAR scan failed.";
    candidates = local as unknown as Array<Record<string, unknown>>;
  }

  const existing = await prisma.creditDocumentSource
    .findMany({
      where: { userId, ticker },
      select: { savedDocumentRefId: true, secUrl: true },
    })
    .catch(() => []);
  const existingKeys = new Set(
    existing
      .map((d) => (d.savedDocumentRefId ? `ref:${d.savedDocumentRefId}` : d.secUrl ? `sec:${d.secUrl}` : null))
      .filter(Boolean) as string[]
  );

  let queued = 0;
  for (const c of candidates.slice(0, maxDocumentsToQueue)) {
    const documentTitle = typeof c.documentTitle === "string" ? c.documentTitle.trim() : "";
    if (!documentTitle) continue;
    const savedDocumentRefId = typeof c.savedDocumentRefId === "string" ? c.savedDocumentRefId.trim() : "";
    const openUrl = typeof c.openUrl === "string" ? c.openUrl.trim() : "";
    const secUrl = openUrl.startsWith("https://www.sec.gov/") ? openUrl : "";
    const key = savedDocumentRefId ? `ref:${savedDocumentRefId}` : secUrl ? `sec:${secUrl}` : "";
    if (!key || existingKeys.has(key)) continue;

    await prisma.creditDocumentSource.create({
      data: {
        userId,
        ticker,
        documentTitle,
        documentType: (typeof c.documentType === "string"
          ? c.documentType
          : inferCreditDocumentTitleType(documentTitle)) as never,
        filingType: (typeof c.filingType === "string" ? c.filingType : "other") as never,
        filingDate: typeof c.filingDate === "string" && c.filingDate ? new Date(c.filingDate) : undefined,
        sourceUrl: typeof c.sourceUrl === "string" ? c.sourceUrl : undefined,
        savedDocumentRefId: savedDocumentRefId || undefined,
        secUrl: secUrl || undefined,
        processed: false,
        processingStatus: "not_started",
      },
    });

    existingKeys.add(key);
    queued++;
  }

  const docs = await prisma.creditDocumentSource
    .findMany({
      where: { userId, ticker },
      orderBy: [{ filingDate: "desc" }, { updatedAt: "desc" }],
    })
    .catch(() => []);

  const toProcess = docs.filter((d) => d.processingStatus !== "extraction_complete").slice(0, maxDocumentsToProcess);

  const processed: Array<Record<string, unknown>> = [];
  for (const d of toProcess) {
    try {
      const r = await processCreditDocumentSource(prisma, { userId, ticker, documentId: d.id });
      processed.push({ documentId: d.id, ok: true, ...r });
    } catch (e) {
      processed.push({ documentId: d.id, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }

  const matrixBuild = await rebuildCreditDocEntityRoleMatrixForTicker(prisma, {
    userId,
    ticker,
  }).catch(() => ({ rowsUpserted: 0 }));

  const matrix = await prisma.creditDocumentEntityRoleMatrixRow
    .findMany({
      where: { userId, ticker },
      orderBy: [{ relevanceScore: "desc" }, { updatedAt: "desc" }],
    })
    .catch(() => []);

  const missingFromEx21 = matrix
    .filter((r) => !r.listedInExhibit21)
    .slice(0, 250)
    .map((r) => ({
      id: r.id,
      entityName: r.entityName,
      confidence: r.confidence,
      relevanceScore: r.relevanceScore,
      keyEvidence: r.keyEvidence,
      roleFlagsJson: r.roleFlagsJson,
      sourceDocumentTitles: r.sourceDocumentTitles,
    }));

  async function plainTextForSource(source: { savedDocumentRefId: string | null; secUrl: string | null; sourceUrl: string | null }) {
    const ref = source.savedDocumentRefId;
    if (ref?.startsWith("user_saved:")) {
      const id = ref.split(":")[1]!;
      const doc = await prisma.userSavedDocument.findFirst({ where: { id, userId, ticker } });
      return doc ? parseCreditDocumentToPlainText(Buffer.from(doc.body)) : "";
    }
    if (ref?.startsWith("public_records:")) {
      const id = ref.split(":")[1]!;
      const doc = await prisma.publicRecordsDocument.findFirst({ where: { id, userId, ticker } });
      if (!doc) return "";
      return doc.extractedText && doc.extractedText.length > 0
        ? doc.extractedText.slice(0, 1_200_000)
        : parseCreditDocumentToPlainText(Buffer.from(doc.body));
    }
    if (ref != null && ref.startsWith("credit_workspace:")) {
      const fn = ref.slice("credit_workspace:".length).trim();
      if (!fn) return "";
      const found = await getCreditAgreementsFileBuffer(userId, ticker, fn);
      return found?.buf?.length ? parseCreditDocumentToPlainText(found.buf) : "";
    }
    const secPick = source.secUrl?.trim() || source.sourceUrl?.trim();
    if (secPick?.startsWith("https://www.sec.gov/")) {
      const fetched = await downloadAndExtractSecDocument(secPick);
      return fetched.text ?? "";
    }
    return "";
  }

  function extractDebtorGuarantorTableSnippets(text: string): Array<{ label: string; snippet: string }> {
    const t = text.replace(/\r/g, "\n");
    const patterns: Array<{ label: string; re: RegExp }> = [
      { label: "Perfection certificate", re: /\bPERFECTION\s+CERTIFICATE\b[\s\S]{0,12000}/i },
      { label: "Borrower/Guarantor info table", re: /\b(BORROWER|GUARANTOR|GRANTOR)\s+(INFORMATION|DETAILS)\b[\s\S]{0,9000}/i },
      { label: "Chief executive office / place of business", re: /\b(CHIEF\s+EXECUTIVE\s+OFFICE|PRINCIPAL\s+PLACE\s+OF\s+BUSINESS|PRINCIPAL\s+EXECUTIVE\s+OFFICES?)\b[\s\S]{0,7000}/i },
      { label: "Notice provisions", re: /\b(NOTICES?|NOTICE\s+ADDRESS|ADDRESS\s+FOR\s+NOTICES?)\b[\s\S]{0,7000}/i },
    ];
    const out: Array<{ label: string; snippet: string }> = [];
    for (const p of patterns) {
      const m = t.match(p.re);
      if (!m?.[0]) continue;
      out.push({ label: p.label, snippet: m[0].replace(/\s+/g, " ").trim().slice(0, 1600) });
      if (out.length >= 6) break;
    }
    return out;
  }

  // Surface “where are the debtor/guarantor tables?” as best-effort snippets from the most relevant docs.
  const docSignals: Array<Record<string, unknown>> = [];
  for (const d of docs.slice(0, 18)) {
    const title = d.documentTitle ?? "";
    const isPerf = /\bperfection\s+certificate\b|\bcollateral\s+information\s+certificate\b|\bucc\s+questionnaire\b/i.test(title);
    const isSchedHeavy = /\bschedule\b|\bdisclosure\s+schedule\b|\bannex\b|\bexhibit\b/i.test(title);
    const shouldPeek = isPerf || isSchedHeavy || /credit agreement|security agreement|collateral agreement|guarant/i.test(title.toLowerCase());
    if (!shouldPeek) continue;
    const text = await plainTextForSource({ savedDocumentRefId: d.savedDocumentRefId, secUrl: d.secUrl, sourceUrl: d.sourceUrl }).catch(() => "");
    const snippets = text.trim() ? extractDebtorGuarantorTableSnippets(text.slice(0, 900_000)) : [];
    docSignals.push({
      documentId: d.id,
      documentTitle: d.documentTitle,
      documentType: d.documentType,
      filingDate: d.filingDate ? d.filingDate.toISOString().slice(0, 10) : null,
      secUrl: d.secUrl ?? null,
      sourceUrl: d.sourceUrl ?? null,
      likelyPerfectionCertificate: isPerf,
      likelyScheduleHeavy: isSchedHeavy,
      snippets,
    });
    if (docSignals.length >= 12) break;
  }

  return NextResponse.json({
    ok: true,
    ticker,
    edgarWarning,
    edgarDebtSearch,
    discoveryCandidatesCount: candidates.length,
    queued,
    processedCount: processed.length,
    matrixBuild,
    docSignals,
    missingFromExhibit21: missingFromEx21,
  });
}

