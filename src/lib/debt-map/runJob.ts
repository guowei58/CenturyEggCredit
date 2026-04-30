import type { DebtIssuerMapJobStatus, DebtMapParsedStatus, DebtMapSourceType } from "@/generated/prisma/client";
import {
  MAX_DEBT_DOCUMENTS_TO_DOWNLOAD,
  MAX_FILINGS_TO_SCAN,
  MAX_RAW_TEXT_CHARS,
} from "@/lib/debt-map/constants";
import { classifyDebtDocumentText } from "@/lib/debt-map/documentClassifier";
import { downloadAndExtractSecDocument } from "@/lib/debt-map/documentFetch";
import {
  extractEntityHintsFromText,
  extractLowConfidenceFromKeywords,
  type ExtractedEntityHint,
} from "@/lib/debt-map/entityHints";
import { extractDebtFootnoteRows, type FootnoteLine } from "@/lib/debt-map/footnoteExtract";
import { filterFilingsForDebtMap } from "@/lib/debt-map/filingFilters";
import {
  buildArchivesFileUrl,
  fetchFilingIndexItems,
  type SecFilingIndexItem,
} from "@/lib/sec/filingIndex";
import { shouldIncludeExhibitFile } from "@/lib/debt-map/exhibitFilters";
import { extractInstrumentStub } from "@/lib/debt-map/instrumentExtract";
import { meanConfidence, reconcileFootnotesToInstruments } from "@/lib/debt-map/reconciler";
import { buildRedFlagsMvp } from "@/lib/debt-map/redFlagRules";
import { resolveCompanyForDebtMap } from "@/lib/debt-map/secCompanyResolver";
import { prisma } from "@/lib/prisma";
import { getAllFilingsByCik, type SecFiling } from "@/lib/sec-edgar";

export type DebtMapJobOptions = {
  include8KExhibits: boolean;
  includeRegistration: boolean;
  includeExhibit21: boolean;
  includeExhibit22: boolean;
  includeOlderIfMissing: boolean;
  includeDef14a: boolean;
};

export function defaultDebtMapJobOptions(): DebtMapJobOptions {
  return {
    include8KExhibits: true,
    includeRegistration: true,
    includeExhibit21: true,
    includeExhibit22: true,
    includeOlderIfMissing: false,
    includeDef14a: false,
  };
}

export function parseDebtMapJobOptions(raw: unknown): DebtMapJobOptions {
  const d = defaultDebtMapJobOptions();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    include8KExhibits: typeof o.include8KExhibits === "boolean" ? o.include8KExhibits : d.include8KExhibits,
    includeRegistration:
      typeof o.includeRegistration === "boolean" ? o.includeRegistration : d.includeRegistration,
    includeExhibit21: typeof o.includeExhibit21 === "boolean" ? o.includeExhibit21 : d.includeExhibit21,
    includeExhibit22: typeof o.includeExhibit22 === "boolean" ? o.includeExhibit22 : d.includeExhibit22,
    includeOlderIfMissing:
      typeof o.includeOlderIfMissing === "boolean" ? o.includeOlderIfMissing : d.includeOlderIfMissing,
    includeDef14a: typeof o.includeDef14a === "boolean" ? o.includeDef14a : d.includeDef14a,
  };
}

async function updateJobStatus(jobId: string, status: DebtIssuerMapJobStatus) {
  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: { status, updatedAt: new Date() },
  });
}

async function failJob(jobId: string, message: string) {
  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

function exhibitWhyIncluded(item: SecFilingIndexItem): string {
  const n = item.name?.toLowerCase() ?? "";
  if (/^ex-?4|ex-?10|ex-?21|ex-?22|ex-?25/.test(n)) return "Exhibit number priority (EX-4/10/21/22/25 family)";
  if (/(indenture|credit|guarantee|collateral|pledge|loan|notes)/i.test(n)) return "Exhibit filename keyword (debt/capital structure)";
  return "Debt-related exhibit heuristic";
}

/**
 * Full sequential pipeline: resolve issuer → scan filings → download exhibits → extract → reconcile → red flags.
 */
export async function runDebtIssuerMapJob(jobId: string): Promise<void> {
  const job = await prisma.debtIssuerMapJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  await prisma.$transaction([
    prisma.debtMapRedFlag.deleteMany({ where: { jobId } }),
    prisma.debtFootnoteItem.deleteMany({ where: { jobId } }),
    prisma.debtInstrumentEntityRole.deleteMany({ where: { jobId } }),
    prisma.debtInstrument.deleteMany({ where: { jobId } }),
    prisma.debtLegalEntity.deleteMany({ where: { jobId } }),
    prisma.debtMapSourceDocument.deleteMany({ where: { jobId } }),
  ]);

  const opts = parseDebtMapJobOptions(job.optionsJson);

  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: {
      filingsScannedCount: 0,
      documentsDownloadedCount: 0,
      candidateDebtDocsCount: 0,
      instrumentsCount: 0,
      legalEntitiesCount: 0,
      redFlagsCount: 0,
      reconciliationConfidence: null,
    },
  });

  await updateJobStatus(jobId, "resolving_company");

  const resolved = await resolveCompanyForDebtMap(job.companyInput);
  if ("error" in resolved) {
    await failJob(jobId, resolved.error);
    return;
  }

  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: {
      cik: resolved.cik,
      companyName: resolved.companyName,
      ticker: resolved.ticker ?? job.ticker,
      status: "fetching_sec_filings",
      updatedAt: new Date(),
    },
  });

  const allFilings = await getAllFilingsByCik(resolved.cik);
  if (!allFilings) {
    await failJob(jobId, "Could not load SEC submissions JSON for this CIK.");
    return;
  }

  let lookback = job.lookbackYears;
  let filtered = filterFilingsForDebtMap(allFilings.filings, lookback, {
    include8K: opts.include8KExhibits,
    includeRegistration: opts.includeRegistration,
    includeDef14a: opts.includeDef14a,
  });

  if (opts.includeOlderIfMissing && filtered.length < 12) {
    lookback = Math.min(25, lookback + 7);
    filtered = filterFilingsForDebtMap(allFilings.filings, lookback, {
      include8K: opts.include8KExhibits,
      includeRegistration: opts.includeRegistration,
      includeDef14a: opts.includeDef14a,
    });
  }

  const filingsLimited = filtered.slice(0, MAX_FILINGS_TO_SCAN);

  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: {
      filingsScannedCount: filingsLimited.length,
      status: "extracting_documents",
      updatedAt: new Date(),
    },
  });

  const cikNum = parseInt(resolved.cik, 10);
  const seenUrl = new Set<string>();
  const downloadQueue: {
    url: string;
    filing: SecFiling;
    fileLabel: string;
    sourceType: DebtMapSourceType;
    why: string;
  }[] = [];

  for (const filing of filingsLimited) {
    if (downloadQueue.length >= MAX_DEBT_DOCUMENTS_TO_DOWNLOAD) break;
    if (!seenUrl.has(filing.docUrl)) {
      seenUrl.add(filing.docUrl);
      downloadQueue.push({
        url: filing.docUrl,
        filing,
        fileLabel: filing.primaryDocument,
        sourceType: "SEC_FILING",
        why: "Primary HTML/TXT document for this filing (SEC)",
      });
    }

    const indexItems = await fetchFilingIndexItems(resolved.cik, filing.accessionNumber);
    for (const it of indexItems) {
      if (downloadQueue.length >= MAX_DEBT_DOCUMENTS_TO_DOWNLOAD) break;
      if (!shouldIncludeExhibitFile(it.name, filing.primaryDocument, opts)) continue;
      const url = buildArchivesFileUrl(cikNum, filing.accessionNumber, it.name);
      if (seenUrl.has(url)) continue;
      seenUrl.add(url);
      downloadQueue.push({
        url,
        filing,
        fileLabel: it.name,
        sourceType: "SEC_EXHIBIT",
        why: exhibitWhyIncluded(it),
      });
    }
  }

  const entityKeyToId = new Map<string, string>();
  const issuerNameList: string[] = [];

  const parentEnt = await prisma.debtLegalEntity.create({
    data: {
      jobId,
      legalName: resolved.companyName,
      normalizedName: resolved.companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      entityType: "public_parent",
      sourceDocumentId: null,
      sourceSnippet: "SEC submissions company name (registrant)",
      confidenceScore: 96,
      notes: "Public registrant — not necessarily borrower/issuer of every debt instrument.",
    },
  });
  entityKeyToId.set(parentEnt.normalizedName, parentEnt.id);

  let downloaded = 0;
  let candidatesDebtish = 0;

  const instrumentRows: { id: string; name: string; principalAmount: string | null; maturityDate: string | null }[] = [];

  for (const q of downloadQueue) {
    const fetched = await downloadAndExtractSecDocument(q.url);
    downloaded++;

    const classification = classifyDebtDocumentText(q.fileLabel, fetched.text || "", q.filing.form);
    if (
      classification === "indenture" ||
      classification === "credit_agreement" ||
      classification === "security_or_guarantee" ||
      classification === "prospectus" ||
      classification === "exhibit_21" ||
      classification === "exhibit_22" ||
      (classification === "other" &&
        /indenture|credit agreement|guarantee|senior notes|term loan|revolving credit/i.test(fetched.text.slice(0, 6000))) ||
      (classification === "periodic_filing" &&
        /debt|borrowings|credit facility|long-term|outstanding.*debt/i.test(fetched.text.slice(0, 12_000)))
    ) {
      candidatesDebtish++;
    }

    const parsedStatus: DebtMapParsedStatus = fetched.ok ? "parsed" : "failed";

    const docRow = await prisma.debtMapSourceDocument.create({
      data: {
        jobId,
        sourceType: q.sourceType,
        filingType: q.filing.form,
        accessionNumber: q.filing.accessionNumber,
        filingDate: q.filing.filingDate,
        exhibitType: q.fileLabel,
        documentName: q.fileLabel,
        documentDescription: q.filing.description ?? null,
        sourceUrl: q.url,
        rawText: fetched.text ? fetched.text.slice(0, MAX_RAW_TEXT_CHARS) : null,
        classifiedAs: classification,
        parsedStatus,
        whyIncluded: `${q.why}${fetched.error ? ` · fetch/extract: ${fetched.error}` : ""}`,
      },
    });

    const text = fetched.text || "";
    if (!text.trim()) continue;

    const stub =
      classification !== "exhibit_21" &&
      classification !== "periodic_filing" &&
      classification !== "other" &&
      text.length > 200
        ? extractInstrumentStub(q.fileLabel, text, classification)
        : null;

    const hints: ExtractedEntityHint[] = [...extractEntityHintsFromText(text)];
    if (
      classification === "indenture" ||
      classification === "credit_agreement" ||
      classification === "security_or_guarantee"
    ) {
      hints.push(...extractLowConfidenceFromKeywords(text));
    }

    if (
      stub &&
      (classification === "indenture" ||
        classification === "credit_agreement" ||
        classification === "security_or_guarantee" ||
        classification === "prospectus")
    ) {
      const ins = await prisma.debtInstrument.create({
        data: {
          jobId,
          instrumentName: stub.instrumentName,
          instrumentType: stub.instrumentType,
          principalAmount: stub.principalAmount,
          couponOrRate: stub.couponOrRate,
          maturityDate: stub.maturityDate,
          securedStatus: stub.securedStatus,
          ranking: null,
          issueDate: null,
          sourceDocumentId: docRow.id,
          sourceSnippet: stub.sourceSnippet,
          confidenceScore: stub.confidenceScore,
          extractionNotes:
            stub.confidenceScore < 70 ? "Candidate extraction — verify principal/maturity in attached exhibit." : null,
        },
      });
      instrumentRows.push({
        id: ins.id,
        name: ins.instrumentName,
        principalAmount: ins.principalAmount,
        maturityDate: ins.maturityDate,
      });

      for (const h of hints) {
        if (h.confidenceScore < 52 && h.sourceSnippet.includes("keyword heuristic")) continue;
        let entId = entityKeyToId.get(h.normalizedName);
        if (!entId) {
          const ent = await prisma.debtLegalEntity.create({
            data: {
              jobId,
              legalName: h.legalName,
              normalizedName: h.normalizedName,
              entityType: h.entityType,
              sourceDocumentId: docRow.id,
              sourceSnippet: h.sourceSnippet,
              confidenceScore: h.confidenceScore,
              notes: h.confidenceScore < 70 ? "Candidate role — confirm in filed indenture/credit agreement." : null,
            },
          });
          entId = ent.id;
          entityKeyToId.set(h.normalizedName, entId);
        }
        await prisma.debtInstrumentEntityRole.create({
          data: {
            jobId,
            debtInstrumentId: ins.id,
            legalEntityId: entId,
            role: h.role,
            sourceDocumentId: docRow.id,
            sourceSnippet: h.sourceSnippet,
            confidenceScore: h.confidenceScore,
          },
        });
        if (h.role === "issuer" || h.role === "co_issuer") issuerNameList.push(h.legalName);
      }
    }

    if (classification === "exhibit_21" && opts.includeExhibit21) {
      const lines = text.split(/\n/).filter((l) => /\b(LLC|L\.P\.|Inc\.|Corp\.|Ltd)/i.test(l));
      for (const line of lines.slice(0, 60)) {
        const name = line.replace(/^[\d.\s•\-]+/, "").trim().slice(0, 240);
        if (name.length < 6) continue;
        const nk = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (entityKeyToId.has(nk)) continue;
        const ent = await prisma.debtLegalEntity.create({
          data: {
            jobId,
            legalName: name,
            normalizedName: nk,
            entityType: "restricted_subsidiary",
            sourceDocumentId: docRow.id,
            sourceSnippet: line.slice(0, 320),
            confidenceScore: 48,
            notes: "From subsidiary schedule text — not a guarantor inference.",
          },
        });
        entityKeyToId.set(nk, ent.id);
      }
    }
  }

  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: {
      documentsDownloadedCount: downloaded,
      candidateDebtDocsCount: candidatesDebtish,
      status: "parsing_debt_docs",
      updatedAt: new Date(),
    },
  });

  await updateJobStatus(jobId, "reconciling");

  const periodicDocs = await prisma.debtMapSourceDocument.findMany({
    where: {
      jobId,
      OR: [{ filingType: { in: ["10-K", "10-Q", "20-F"] } }, { classifiedAs: "periodic_filing" }],
      rawText: { not: null },
    },
    take: 10,
  });

  let footnoteLines: FootnoteLine[] = [];
  for (const d of periodicDocs) {
    if (d.rawText) footnoteLines = footnoteLines.concat(extractDebtFootnoteRows(d.rawText));
  }

  const footMatches = reconcileFootnotesToInstruments(
    footnoteLines,
    instrumentRows.map((r) => ({
      id: r.id,
      instrumentName: r.name,
      principalAmount: r.principalAmount,
      maturityDate: r.maturityDate,
    }))
  );

  for (let i = 0; i < footnoteLines.length; i++) {
    const fn = footnoteLines[i]!;
    const m = footMatches[i];
    if (!m) continue;
    await prisma.debtFootnoteItem.create({
      data: {
        jobId,
        description: fn.description,
        principalAmount: fn.principalAmount,
        carryingValue: fn.carryingValue,
        maturityDate: fn.maturityDate,
        rate: fn.rate,
        sourceDocumentId: null,
        matchedDebtInstrumentId: m.matchedInstrumentId,
        confidenceScore: m.confidenceScore,
        notes: m.gapNote,
      },
    });
  }

  const matchedInstrumentIds = new Set(
    footMatches
      .filter((fm) => fm.matchedInstrumentId && fm.confidenceScore >= 42)
      .map((fm) => fm.matchedInstrumentId as string)
  );
  const instrumentsWithoutFootnote = instrumentRows.filter((r) => !matchedInstrumentIds.has(r.id)).map((r) => r.id);

  const footnotesWithoutInstrument = footMatches.filter((fm) => !fm.matchedInstrumentId).length;

  const anyText = (await prisma.debtMapSourceDocument.findMany({ where: { jobId }, select: { rawText: true } }))
    .map((d) => d.rawText ?? "")
    .join("\n");

  const guarantorEntities = await prisma.debtLegalEntity.findMany({
    where: { jobId, entityType: "guarantor" },
    select: { legalName: true },
  });

  const subs = await prisma.debtLegalEntity.findMany({
    where: { jobId, entityType: "restricted_subsidiary" },
    select: { legalName: true },
  });

  const redDrafts = buildRedFlagsMvp({
    publicParentName: resolved.companyName,
    issuerNames: [...new Set(issuerNameList)],
    instrumentsWithoutFootnote,
    footnotesWithoutInstrument,
    hasSecuredWithoutGrantors: /\bsecured\b/i.test(anyText) && !/\bgrantor\b/i.test(anyText),
    hasReceivablesLanguage: /receivables|securitization|special purpose|SPV/i.test(anyText),
    hasUnrestrictedLanguage: /unrestricted subsidiary/i.test(anyText),
    materialSubsNames: subs.slice(0, 40).map((s) => s.legalName),
    guarantorNames: guarantorEntities.map((g) => g.legalName),
  });

  for (const rf of redDrafts) {
    await prisma.debtMapRedFlag.create({
      data: {
        jobId,
        severity: rf.severity,
        category: rf.category,
        title: rf.title,
        description: rf.description,
        relatedInstrumentId: rf.relatedInstrumentId ?? null,
        relatedEntityId: rf.relatedEntityId ?? null,
        sourceDocumentId: null,
        sourceSnippet: rf.sourceSnippet ?? null,
        manualFollowUp: rf.manualFollowUp,
      },
    });
  }

  const reconcConf = meanConfidence(footMatches);

  const counts = await prisma.$transaction([
    prisma.debtInstrument.count({ where: { jobId } }),
    prisma.debtLegalEntity.count({ where: { jobId } }),
    prisma.debtMapRedFlag.count({ where: { jobId } }),
  ]);

  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: {
      status: "complete",
      instrumentsCount: counts[0],
      legalEntitiesCount: counts[1],
      redFlagsCount: counts[2],
      reconciliationConfidence: reconcConf,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
