import { NextResponse } from "next/server";
import {
  fetchEdgarPrimaryDocumentHtml,
  getAllFilingsByTicker,
  rankEarningsAdjacent8KFilings,
  rankEarningsAdjacent8KFilingsWithPrimaryItemScan,
  secAccessionDedupeKey,
  secArchivesPrimaryDocumentUrl,
  secFilingIsEarningsPressRelease8K,
} from "@/lib/sec-edgar";
import {
  buildArchivesFileUrl,
  fetchAccessionSubmissionTxt,
  fetchArchivesFilingFileHtml,
  fetchFilingIndexItems,
  html8KPrimaryDefersEarningsToExhibitAttachment,
  htmlLooksLikePersonnelOnlyPressNotEarningsResults,
  looksLike8kFormCoverShellHtml,
  parseExhibit99HtmlFilenamesFromSubmissionTxt,
  rankExhibit99HtmlFilenames,
} from "@/lib/sec/filingIndex";
import {
  classifyEarningsExhibitHtml,
  extractEbitdaReconciliationFromIxbrlHtml,
  extractPressReleaseBodyHtmlForDisplay,
  extractSlideDeckBodyHtmlForDisplay,
  fetchIxbrlMdnaTablesFromFiling,
  MAX_EARNINGS_PRESS_RELEASE_HTML_CHARS,
  pickEarningsMainAndDeck,
  type EarningsPressReleasePayload,
  type IxbrlEbitdaSupplementalSource,
} from "@/lib/sec-ixbrl-mdna-tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const NEARBY_8K_MAX_ATTEMPTS = 10;
const MAX_EX99_HTML_PER_8K = 8;
const NEARBY_8K_FETCH_PACE_MS = 140;

async function pace(): Promise<void> {
  await new Promise((r) => setTimeout(r, NEARBY_8K_FETCH_PACE_MS));
}

async function rankedExhibit99HtmlFor8KFiling(
  issuerCik: string,
  k8: { accessionNumber: string; primaryDocument?: string | null }
): Promise<string[]> {
  const prim = (k8.primaryDocument ?? "").trim();
  const [indexItems, submissionTxt] = await Promise.all([
    fetchFilingIndexItems(issuerCik, k8.accessionNumber),
    fetchAccessionSubmissionTxt(issuerCik, k8.accessionNumber),
  ]);
  const fromTxt = submissionTxt ? parseExhibit99HtmlFilenamesFromSubmissionTxt(submissionTxt) : [];
  return rankExhibit99HtmlFilenames(indexItems.map((it) => it.name), {
    primaryDocumentForOrdering: prim || undefined,
    submissionTxtExhibit99Ordered: fromTxt.length > 0 ? fromTxt : undefined,
  }).slice(0, MAX_EX99_HTML_PER_8K);
}

function ixbrlSourceFor8KAttachment(
  issuerCik: string,
  issuerCikNum: number,
  k8: { form: string; filingDate: string; accessionNumber: string; primaryDocument?: string | null },
  filename: string
): IxbrlEbitdaSupplementalSource | null {
  const prim = (k8.primaryDocument ?? "").trim();
  if (prim.length > 0 && prim.toLowerCase() === filename.trim().toLowerCase()) {
    const primaryDocumentUrl = secArchivesPrimaryDocumentUrl(issuerCik, {
      accessionNumber: k8.accessionNumber,
      primaryDocument: prim,
    });
    if (primaryDocumentUrl == null) return null;
    return {
      form: k8.form,
      filingDate: k8.filingDate,
      accessionNumber: k8.accessionNumber,
      primaryDocument: prim,
      primaryDocumentUrl,
      documentRole: "primary",
    };
  }
  if (!Number.isFinite(issuerCikNum) || issuerCikNum <= 0) return null;
  return {
    form: k8.form,
    filingDate: k8.filingDate,
    accessionNumber: k8.accessionNumber,
    primaryDocument: filename.trim(),
    primaryDocumentUrl: buildArchivesFileUrl(issuerCikNum, k8.accessionNumber, filename),
    documentRole: "exhibit_99",
  };
}

/**
 * Pick the first HTML in `orderedFilenames` that is not a bare Form 8-K cover shell when alternatives exist.
 */
async function resolvePressReleaseSourceFromRankedHtml(
  issuerCik: string,
  k8: { form: string; filingDate: string; accessionNumber: string; primaryDocument?: string | null },
  orderedFilenames: string[]
): Promise<IxbrlEbitdaSupplementalSource | null> {
  const issuerCikNum = parseInt(issuerCik.replace(/\D/g, ""), 10);
  if (orderedFilenames.length === 0) {
    return suggestedPressReleaseFor8K(issuerCik, k8, []);
  }
  for (let i = 0; i < orderedFilenames.length; i++) {
    await pace();
    const fn = orderedFilenames[i]!;
    const html = await fetchArchivesFilingFileHtml(issuerCik, k8.accessionNumber, fn);
    if (!html) continue;
    const more = i < orderedFilenames.length - 1;
    if (htmlLooksLikePersonnelOnlyPressNotEarningsResults(html)) continue;
    if (!looksLike8kFormCoverShellHtml(html) || !more) {
      const src = ixbrlSourceFor8KAttachment(issuerCik, issuerCikNum, k8, fn);
      if (src) return src;
    }
  }
  return suggestedPressReleaseFor8K(issuerCik, k8, []);
}

/**
 * Best URL to open for “the earnings release” for a candidate 8-K: first ranked Exhibit 99.x HTML, else the primary document.
 * Used when we scan for EBITDA tables but do not auto-detect one — still deep-link the user to the press-release HTML.
 */
function suggestedPressReleaseFor8K(
  issuerCik: string,
  k8: { form: string; filingDate: string; accessionNumber: string; primaryDocument?: string | null },
  rankedEx99Html: string[]
): IxbrlEbitdaSupplementalSource | null {
  const issuerCikNum = parseInt(issuerCik.replace(/\D/g, ""), 10);
  if (rankedEx99Html.length > 0) {
    const direct = ixbrlSourceFor8KAttachment(issuerCik, issuerCikNum, k8, rankedEx99Html[0]!);
    if (direct) return direct;
  }
  const primaryDocumentUrl = secArchivesPrimaryDocumentUrl(issuerCik, {
    accessionNumber: k8.accessionNumber,
    primaryDocument: (k8.primaryDocument ?? "").trim(),
  });
  if (primaryDocumentUrl == null) return null;
  return {
    form: k8.form,
    filingDate: k8.filingDate,
    accessionNumber: k8.accessionNumber,
    primaryDocument: (k8.primaryDocument ?? "").trim(),
    primaryDocumentUrl,
    documentRole: "primary",
  };
}

async function buildPressReleaseSourceFor8K(
  issuerCik: string,
  k8: { form: string; filingDate: string; accessionNumber: string; primaryDocument?: string | null }
): Promise<IxbrlEbitdaSupplementalSource | null> {
  const ordered = await rankedExhibit99HtmlFor8KFiling(issuerCik, k8);
  return resolvePressReleaseSourceFromRankedHtml(issuerCik, k8, ordered);
}

async function fetchPressReleaseFullHtml(
  issuerCik: string,
  src: IxbrlEbitdaSupplementalSource
): Promise<string | null> {
  if (src.documentRole === "exhibit_99") {
    return fetchArchivesFilingFileHtml(issuerCik, src.accessionNumber, src.primaryDocument);
  }
  return fetchEdgarPrimaryDocumentHtml(issuerCik, {
    accessionNumber: src.accessionNumber,
    primaryDocument: src.primaryDocument,
  });
}

function buildEarningsDisplayPayload(
  source: IxbrlEbitdaSupplementalSource,
  rawHtml: string,
  exhibitClass: "press_release" | "slide_deck"
): EarningsPressReleasePayload {
  const fragment =
    exhibitClass === "slide_deck"
      ? extractSlideDeckBodyHtmlForDisplay(rawHtml, source.primaryDocumentUrl)
      : extractPressReleaseBodyHtmlForDisplay(rawHtml);
  const truncated = fragment.length > MAX_EARNINGS_PRESS_RELEASE_HTML_CHARS;
  const html = truncated ? fragment.slice(0, MAX_EARNINGS_PRESS_RELEASE_HTML_CHARS) : fragment;
  return { source, html, truncated, exhibitClass };
}

type ClassifiedEarningsExhibitRow = {
  filename: string;
  src: IxbrlEbitdaSupplementalSource;
  html: string;
  kind: "press_release" | "slide_deck";
};

async function classifyRankedExhibit99HtmlForEarningsDisplay(
  issuerCik: string,
  k8: { form: string; filingDate: string; accessionNumber: string; primaryDocument?: string | null },
  orderedFilenames: string[],
  reuse?: { primaryDocument: string; html: string | null }
): Promise<ClassifiedEarningsExhibitRow[]> {
  const issuerCikNum = parseInt(issuerCik.replace(/\D/g, ""), 10);
  const rows: ClassifiedEarningsExhibitRow[] = [];
  for (let i = 0; i < orderedFilenames.length; i++) {
    await pace();
    const fn = orderedFilenames[i]!;
    const more = i < orderedFilenames.length - 1;
    let html: string | null = null;
    if (
      reuse?.html &&
      reuse.primaryDocument.trim().toLowerCase() === fn.trim().toLowerCase()
    ) {
      html = reuse.html;
    } else {
      html = await fetchArchivesFilingFileHtml(issuerCik, k8.accessionNumber, fn);
    }
    if (!html) continue;
    if (htmlLooksLikePersonnelOnlyPressNotEarningsResults(html)) continue;
    if (looksLike8kFormCoverShellHtml(html) && more) continue;
    const src = ixbrlSourceFor8KAttachment(issuerCik, issuerCikNum, k8, fn);
    if (!src) continue;
    const kind = classifyEarningsExhibitHtml(html, fn);
    rows.push({ filename: fn, src, html, kind });
  }
  return rows;
}

export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const url = new URL(req.url);
  const acc = (url.searchParams.get("acc") ?? "").trim();
  const uncertainQ = url.searchParams.get("uncertain");
  const includeUncertainBoundaries: boolean | undefined =
    uncertainQ === "1" || uncertainQ === "true"
      ? true
      : uncertainQ === "0" || uncertainQ === "false"
        ? false
        : undefined;
  const lowConfQ = url.searchParams.get("lowConf");
  const includeLowConfidenceTables: boolean | undefined =
    lowConfQ === "1" || lowConfQ === "true"
      ? true
      : lowConfQ === "0" || lowConfQ === "false"
        ? false
        : undefined;

  const filingsRes = await getAllFilingsByTicker(sym);
  if (!filingsRes) return NextResponse.json({ error: "SEC submissions not found for ticker" }, { status: 404 });

  const cutoffYear = new Date().getFullYear() - 20;
  const filings = filingsRes.filings
    .filter((f) => f.form === "10-K" || f.form === "10-Q")
    .filter((f) => {
      const y = parseInt((f.filingDate ?? "").slice(0, 4), 10);
      return Number.isFinite(y) ? y >= cutoffYear : true;
    })
    .slice(0, 600);

  /** Filings are newest-first; default to latest 10-K or 10-Q (not “latest 10-K only”). */
  const chosen =
    (acc ? filings.find((f) => f.accessionNumber === acc) : filings[0]) ?? null;

  if (!chosen) {
    return NextResponse.json({ error: "No 10-K/10-Q filings found" }, { status: 404 });
  }

  const primaryDocument = (chosen.primaryDocument ?? "").trim();
  if (!primaryDocument) {
    return NextResponse.json({ ok: false, error: "Filing has no primary document path" }, { status: 400 });
  }

  const extracted = await fetchIxbrlMdnaTablesFromFiling({
    cik: filingsRes.cik,
    accessionNumber: chosen.accessionNumber,
    primaryDocument,
    form: chosen.form,
    includeUncertainBoundaries,
    includeLowConfidenceTables,
  });

  if (!extracted.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: extracted.error,
        ticker: sym,
        cik: filingsRes.cik,
        companyName: filingsRes.companyName,
        selected: {
          form: chosen.form,
          filingDate: chosen.filingDate,
          ...(chosen.reportDate?.trim() ? { reportDate: chosen.reportDate.trim() } : {}),
          accessionNumber: chosen.accessionNumber,
          primaryDocument,
        },
        mdnaHeadingFound: false,
        segmentHeadingFound: false,
        mdnaTableHit: false,
        mdnaSectionHtml: null,
        mdnaSectionHtmlTruncated: false,
        tables: [],
        ebitdaReconciliation: { status: "none" as const, tables: [] },
      },
      { status: 502 }
    );
  }

  const periodicForm = (chosen.form ?? "").trim().toUpperCase();
  const reportDate = (chosen.reportDate ?? "").trim();
  const usePeriodEnd =
    (periodicForm === "10-Q" || periodicForm === "10-K") &&
    /^\d{4}-\d{2}-\d{2}$/.test(reportDate.slice(0, 10));
  const anchorDate = usePeriodEnd ? reportDate : chosen.filingDate;
  const rankOpts = { anchorIsPeriodEnd: usePeriodEnd };
  const quickRanked = rankEarningsAdjacent8KFilings(filingsRes.filings, anchorDate, rankOpts);
  let primaryHtmlByAccessionKey = new Map<string, string | null>();
  let item202ByAccessionKey = new Map<string, boolean>();
  let candidates = quickRanked;
  if (quickRanked.length >= 1) {
    const scanned = await rankEarningsAdjacent8KFilingsWithPrimaryItemScan(
      filingsRes.cik,
      filingsRes.filings,
      anchorDate,
      { ...rankOpts, paceMs: NEARBY_8K_FETCH_PACE_MS }
    );
    candidates = scanned.ranked;
    primaryHtmlByAccessionKey = scanned.primaryHtmlByAccessionKey;
    item202ByAccessionKey = scanned.item202ByAccessionKey;
  }
  const toTryAll = candidates.slice(0, NEARBY_8K_MAX_ATTEMPTS);
  const toTryEarnings = toTryAll.filter((f) => secFilingIsEarningsPressRelease8K(f, item202ByAccessionKey));
  const toTry = toTryEarnings.length > 0 ? toTryEarnings : toTryAll;

  let ebitdaReconciliation = extracted.ebitdaReconciliation;
  let capturedPressReleaseHtml: string | null = null;

  if (ebitdaReconciliation.status !== "tables") {
    const nearbyTried = toTry.length;
    let suggestedPressRelease: IxbrlEbitdaSupplementalSource | null = null;

    outer: for (let i = 0; i < toTry.length; i++) {
      const k8 = toTry[i]!;
      /** Exhibit `index.json` and attachments use the same issuer directory as submissions (`filingsRes.cik`). */
      const issuerCik = filingsRes.cik;
      const issuerCikNum = parseInt(issuerCik.replace(/\D/g, ""), 10);

      const accKey = secAccessionDedupeKey(k8.accessionNumber);
      const cached = accKey ? primaryHtmlByAccessionKey.get(accKey) : undefined;
      const htmlPrimary =
        cached !== undefined ? cached : await fetchEdgarPrimaryDocumentHtml(issuerCik, k8);
      if (htmlPrimary) {
        const alt = extractEbitdaReconciliationFromIxbrlHtml(htmlPrimary, "8-K", { includeUncertainBoundaries: false });
        if (alt.status === "tables" && alt.tables.length > 0) {
          const primaryDocumentUrl = secArchivesPrimaryDocumentUrl(issuerCik, k8);
          if (primaryDocumentUrl != null) {
            capturedPressReleaseHtml = htmlPrimary;
            ebitdaReconciliation = {
              ...alt,
              supplementalSource: {
                form: k8.form,
                filingDate: k8.filingDate,
                accessionNumber: k8.accessionNumber,
                primaryDocument: k8.primaryDocument,
                primaryDocumentUrl,
                documentRole: "primary",
              },
              nearby8KScan: { candidatesTried: nearbyTried },
            };
            break outer;
          }
        }
      }

      await pace();

      const exhibitNames = await rankedExhibit99HtmlFor8KFiling(issuerCik, k8);

      if (i === 0) {
        suggestedPressRelease = await resolvePressReleaseSourceFromRankedHtml(issuerCik, k8, exhibitNames);
      }

      for (const exhibitFile of exhibitNames) {
        const htmlEx = await fetchArchivesFilingFileHtml(issuerCik, k8.accessionNumber, exhibitFile);
        if (htmlEx) {
          const altEx = extractEbitdaReconciliationFromIxbrlHtml(htmlEx, "8-K", { includeUncertainBoundaries: false });
          if (altEx.status === "tables" && altEx.tables.length > 0 && Number.isFinite(issuerCikNum) && issuerCikNum > 0) {
            const supplementalSource = ixbrlSourceFor8KAttachment(issuerCik, issuerCikNum, k8, exhibitFile);
            if (supplementalSource) {
              capturedPressReleaseHtml = htmlEx;
              ebitdaReconciliation = {
                ...altEx,
                supplementalSource,
                nearby8KScan: { candidatesTried: nearbyTried },
              };
              break outer;
            }
          }
        }
        await pace();
      }

      if (i + 1 < toTry.length) await pace();
    }

    if (ebitdaReconciliation.status !== "tables" && nearbyTried > 0) {
      ebitdaReconciliation = {
        ...ebitdaReconciliation,
        nearby8KScan: { candidatesTried: nearbyTried },
        ...(suggestedPressRelease ? { suggestedPressRelease } : {}),
      };
    }
  }

  let pressSrc: IxbrlEbitdaSupplementalSource | null =
    ebitdaReconciliation.supplementalSource ?? ebitdaReconciliation.suggestedPressRelease ?? null;
  if (!pressSrc && toTry.length > 0) {
    await pace();
    pressSrc = await buildPressReleaseSourceFor8K(filingsRes.cik, toTry[0]!);
  }

  let rawPressHtml = capturedPressReleaseHtml;
  if (!rawPressHtml && pressSrc) {
    await pace();
    rawPressHtml = await fetchPressReleaseFullHtml(filingsRes.cik, pressSrc);
  }

  let earningsPressRelease: EarningsPressReleasePayload | undefined;
  let earningsSlideDeck: EarningsPressReleasePayload | undefined;

  const k8ForEarnings =
    pressSrc != null
      ? (toTry.find(
          (f) => secAccessionDedupeKey(f.accessionNumber) === secAccessionDedupeKey(pressSrc!.accessionNumber)
        ) ?? toTry[0] ?? null)
      : toTry[0] ?? null;

  if (k8ForEarnings) {
    const ordered = await rankedExhibit99HtmlFor8KFiling(filingsRes.cik, k8ForEarnings);
    if (ordered.length > 0) {
      const reuse =
        pressSrc?.documentRole === "exhibit_99" && rawPressHtml
          ? { primaryDocument: pressSrc.primaryDocument, html: rawPressHtml }
          : undefined;
      const classified = await classifyRankedExhibit99HtmlForEarningsDisplay(
        filingsRes.cik,
        k8ForEarnings,
        ordered,
        reuse
      );
      const pick = pickEarningsMainAndDeck(classified.map((c) => ({ filename: c.filename, kind: c.kind })));
      if (pick != null) {
        const mainRow = classified[pick.main]!;
        if (mainRow.kind === "press_release") {
          earningsPressRelease = buildEarningsDisplayPayload(mainRow.src, mainRow.html, mainRow.kind);
          if (pick.deck != null) {
            const deckRow = classified[pick.deck]!;
            earningsSlideDeck = buildEarningsDisplayPayload(deckRow.src, deckRow.html, "slide_deck");
          }
        } else {
          const deckPayload = buildEarningsDisplayPayload(mainRow.src, mainRow.html, "slide_deck");
          earningsSlideDeck = deckPayload;
          // Image-based earnings exhibits (e.g. CMPR Workiva JPG decks) are the press-release body when no prose PR exists.
          earningsPressRelease = deckPayload;
        }
      }
    }
  }

  if (!earningsPressRelease && k8ForEarnings) {
    const primaryDoc = (k8ForEarnings.primaryDocument ?? "").trim();
    const primaryUrl = secArchivesPrimaryDocumentUrl(filingsRes.cik, k8ForEarnings);
    let primaryHtml =
      pressSrc?.documentRole === "primary" &&
      secAccessionDedupeKey(pressSrc.accessionNumber) === secAccessionDedupeKey(k8ForEarnings.accessionNumber)
        ? rawPressHtml
        : null;
    if (!primaryHtml && primaryDoc) {
      await pace();
      primaryHtml = await fetchEdgarPrimaryDocumentHtml(filingsRes.cik, k8ForEarnings);
    }
    if (
      primaryHtml &&
      primaryUrl &&
      !looksLike8kFormCoverShellHtml(primaryHtml) &&
      !html8KPrimaryDefersEarningsToExhibitAttachment(primaryHtml) &&
      classifyEarningsExhibitHtml(primaryHtml, primaryDoc) === "press_release"
    ) {
      earningsPressRelease = buildEarningsDisplayPayload(
        {
          form: k8ForEarnings.form,
          filingDate: k8ForEarnings.filingDate,
          accessionNumber: k8ForEarnings.accessionNumber,
          primaryDocument: primaryDoc,
          primaryDocumentUrl: primaryUrl,
          documentRole: "primary",
        },
        primaryHtml,
        "press_release"
      );
    }
  }

  if (!earningsPressRelease && pressSrc && rawPressHtml) {
    if (
      pressSrc.documentRole === "primary" &&
      (looksLike8kFormCoverShellHtml(rawPressHtml) ||
        html8KPrimaryDefersEarningsToExhibitAttachment(rawPressHtml))
    ) {
      // Keep earningsSlideDeck / empty — do not show the Form 8-K cover in the press-release tab.
    } else if (earningsSlideDeck) {
      earningsPressRelease = earningsSlideDeck;
    } else {
      const exhibitClass =
        pressSrc.documentRole === "exhibit_99"
          ? classifyEarningsExhibitHtml(rawPressHtml, pressSrc.primaryDocument)
          : ("press_release" as const);
      earningsPressRelease = buildEarningsDisplayPayload(pressSrc, rawPressHtml, exhibitClass);
    }
  }

  return NextResponse.json({
    ok: true,
    ticker: sym,
    cik: filingsRes.cik,
    companyName: filingsRes.companyName,
    selected: {
      form: chosen.form,
      filingDate: chosen.filingDate,
      ...(chosen.reportDate?.trim() ? { reportDate: chosen.reportDate.trim() } : {}),
      accessionNumber: chosen.accessionNumber,
      primaryDocument,
    },
    primaryDocument: extracted.primaryDocument,
    mdnaHeadingFound: extracted.mdnaHeadingFound,
    segmentHeadingFound: extracted.segmentHeadingFound,
    mdnaTableHit: extracted.mdnaTableHit,
    mdnaSectionHtml: extracted.mdnaSectionHtml,
    mdnaSectionHtmlTruncated: extracted.mdnaSectionHtmlTruncated,
    tables: extracted.tables,
    diagnostics: extracted.diagnostics,
    ebitdaReconciliation,
    earningsPressRelease,
    earningsSlideDeck,
  });
}
