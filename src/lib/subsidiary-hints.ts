/**
 * Server-only: suggest legal-entity names for USPTO / trademark-style searches.
 * Combines saved Subsidiary List text and heuristic extraction from latest 10-K/10-Q.
 */

import {
  extractSubsidiaryNamesFromFilingForHints,
  extractSubsidiaryNamesFromStandaloneExhibitBody,
  parseSubsidiaryNamesFromSavedMarkdown,
} from "@/lib/subsidiary-name-hints";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import {
  bodyContainsExhibit21Marker,
  resolveExhibit21AcrossAnnualFilings,
  resolveExhibit21DocumentUrl,
} from "@/lib/sec-filing-exhibits";
import { extractExhibit21CandidateUrlsFromPrimaryHtml } from "@/lib/sec-primary-doc-exhibit-links";
import { getFilingsByTicker, getAllFilingsByTicker, type SecFiling } from "@/lib/sec-edgar";
import { pickLatestAnnualReport } from "@/lib/secAnnualReportForms";

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

async function fetchSecDocument(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Prefer validated Exhibit 21 from any recent plain 10-K/20-F, else single-filing resolution. */
async function resolveBestExhibit21Url(ticker: string, cik: string, fallbackFiling: SecFiling): Promise<string | null> {
  const bundle = await getAllFilingsByTicker(ticker);
  if (bundle?.filings?.length) {
    const ex = await resolveExhibit21AcrossAnnualFilings(cik, bundle.filings, 14);
    if (ex.exhibit21Url) return ex.exhibit21Url;
  }
  return resolveExhibit21DocumentUrl(cik, fallbackFiling.accessionNumber, fallbackFiling.docUrl);
}

function normalizedHrefKey(url: string): string | null {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function is10Q(form: string): boolean {
  const u = form.trim().toUpperCase();
  return u === "10-Q" || u === "10-Q/A";
}

export type SubsidiaryHintsOk = {
  ok: true;
  companyName: string;
  names: string[];
  sources: string[];
  disclaimer: string;
};

export type SubsidiaryHintsResult = SubsidiaryHintsOk | { ok: false; message: string };

/** `uspto-hints` = short lists for trademark-style APIs; `public-records` = full Exhibit 21 schedule for profile ingest. */
export type SubsidiaryExtractionProfile = "uspto-hints" | "public-records";

const EXTRACTION_LIMITS = {
  "uspto-hints": { returnCap: 36, ex21: 48, embedded: 28, saved: 32 },
  "public-records": { returnCap: 12_000, ex21: 12_000, embedded: 2_000, saved: 8_000 },
} as const;

async function ingestSubsidiariesFromLinkedPrimaryPages(
  rawHtml: string,
  primaryDocUrl: string,
  fetchedUrls: Set<string>,
  filingDescription: string,
  profile: SubsidiaryExtractionProfile,
  L: (typeof EXTRACTION_LIMITS)[SubsidiaryExtractionProfile],
  comprehensive: boolean,
  appendDomicile: boolean,
  pushName: (n: string) => void,
  sources: string[]
): Promise<void> {
  const candidates = extractExhibit21CandidateUrlsFromPrimaryHtml(rawHtml, primaryDocUrl);
  const maxLinks = profile === "public-records" ? 10 : 5;
  let linkFetchCount = 0;
  for (const linkUrl of candidates) {
    if (linkFetchCount >= maxLinks) break;
    const key = normalizedHrefKey(linkUrl);
    if (!key || fetchedUrls.has(key)) continue;
    fetchedUrls.add(key);
    linkFetchCount++;
    const body = await fetchSecDocument(linkUrl);
    if (!body || body.length < 80) continue;
    if (!bodyContainsExhibit21Marker(body)) continue;
    const fromLink = extractSubsidiaryNamesFromStandaloneExhibitBody(body, L.ex21, comprehensive, appendDomicile);
    if (fromLink.length === 0) continue;
    for (const n of fromLink) pushName(n);
    const tail = decodeURIComponent(linkUrl.split("/").pop()?.split("?")[0] ?? "attachment");
    sources.push(`${filingDescription} — subsidiary table from link in primary filing (${tail})`);
  }
}

/** When set, subsidiary extraction uses this 10-K only (matches HQ / latest-10-K ingest). */
export type GetSubsidiaryHintsOptions = {
  alignedTenK?: SecFiling;
  cik?: string;
  registrantName?: string;
  subsidiaryExtractionProfile?: SubsidiaryExtractionProfile;
};

export async function getSubsidiaryHintsForTicker(
  ticker: string,
  userId?: string | null,
  options?: GetSubsidiaryHintsOptions
): Promise<SubsidiaryHintsResult> {
  const t = ticker?.trim();
  if (!t) return { ok: false, message: "Ticker required" };

  const profile = options?.subsidiaryExtractionProfile ?? "uspto-hints";
  const L = EXTRACTION_LIMITS[profile];
  const comprehensive = profile === "public-records";
  const appendDom = comprehensive;

  const sources: string[] = [];
  const names: string[] = [];
  const seenLower = new Set<string>();

  function pushName(name: string) {
    const n = name.replace(/\s+/g, " ").trim();
    if (n.length < 2 || n.length > 360) return;
    const k = n.toLowerCase();
    if (seenLower.has(k)) return;
    seenLower.add(k);
    names.push(n);
  }

  let companyName = t.toUpperCase();

  const saved = await readSavedContent(t, "subsidiary-list", userId);
  if (profile !== "public-records" && saved && saved.trim().length > 120) {
    const fromSaved = parseSubsidiaryNamesFromSavedMarkdown(saved, L.saved);
    if (fromSaved.length > 0) {
      for (const n of fromSaved) pushName(n);
      sources.push('Saved "Subsidiary List" tab (markdown tables / bullets)');
    }
  }

  const aligned = options?.alignedTenK;
  const alignedCik = options?.cik?.trim();

  if (aligned && alignedCik) {
    companyName = options?.registrantName?.replace(/\s+/g, " ").trim() || t.toUpperCase();

    if (profile === "public-records") {
      const fetchedAttachmentUrls = new Set<string>();
      const primaryKey = normalizedHrefKey(aligned.docUrl);
      if (primaryKey) fetchedAttachmentUrls.add(primaryKey);

      const ex21Url = await resolveBestExhibit21Url(t, alignedCik, aligned);
      if (ex21Url) {
        const exKey = normalizedHrefKey(ex21Url);
        if (exKey) fetchedAttachmentUrls.add(exKey);
        const ex21Body = await fetchSecDocument(ex21Url);
        if (ex21Body && ex21Body.length > 80) {
          const fromEx21 = extractSubsidiaryNamesFromStandaloneExhibitBody(
            ex21Body,
            L.ex21,
            comprehensive,
            appendDom
          );
          for (const n of fromEx21) pushName(n);
          if (fromEx21.length > 0) {
            sources.push(`10-K Exhibit 21 — separate SEC file (${aligned.filingDate}, same accession as ingest)`);
          }
        }
      }

      if (names.length === 0 && aligned.docUrl) {
        const rawText = await fetchSecDocument(aligned.docUrl);
        if (rawText && rawText.length > 500) {
          const fromFiling = extractSubsidiaryNamesFromFilingForHints(
            rawText,
            L.embedded,
            comprehensive,
            appendDom
          );
          for (const n of fromFiling) pushName(n);
          if (fromFiling.length > 0) {
            sources.push(
              `${aligned.form} (${aligned.filingDate}) — Exhibit 21 section embedded in primary document (no separate Exhibit 21 attachment)`
            );
          }
        }
      }

      const disclaimerPr =
        "Subsidiary names and domiciles are taken only from SEC Schedule Exhibit 21 in the same annual filing (standalone attachment when present, otherwise the Exhibit 21 section in the primary HTML). Use Refresh on the Public Records profile after the company files an updated 10-K if needed.";

      if (names.length === 0) {
        return {
          ok: false,
          message:
            "Could not read a subsidiary list from Exhibit 21 in the latest annual filing. Open the SEC filing and confirm Exhibit 21 is included.",
        };
      }

      return {
        ok: true,
        companyName,
        names: names.slice(0, L.returnCap),
        sources: Array.from(new Set(sources)),
        disclaimer: disclaimerPr,
      };
    }

    pushName(companyName);

    const fetchedAttachmentUrls = new Set<string>();
    const primaryKey = normalizedHrefKey(aligned.docUrl);
    if (primaryKey) fetchedAttachmentUrls.add(primaryKey);

    if (aligned.docUrl) {
      const rawText = await fetchSecDocument(aligned.docUrl);
      if (rawText && rawText.length > 500) {
        const fromFiling = extractSubsidiaryNamesFromFilingForHints(rawText, L.embedded, comprehensive, appendDom);
        for (const n of fromFiling) pushName(n);
        if (fromFiling.length > 0) {
          sources.push(
            `${aligned.form} (${aligned.filingDate}) — Exhibit 21 section embedded in primary document (same filing as latest 10-K ingest)`
          );
        }
        await ingestSubsidiariesFromLinkedPrimaryPages(
          rawText,
          aligned.docUrl,
          fetchedAttachmentUrls,
          `${aligned.form} (${aligned.filingDate})`,
          profile,
          L,
          comprehensive,
          appendDom,
          pushName,
          sources
        );
      }
    }

    const ex21Url = await resolveBestExhibit21Url(t, alignedCik, aligned);
    if (ex21Url) {
      const exKey = normalizedHrefKey(ex21Url);
      if (exKey && !fetchedAttachmentUrls.has(exKey)) {
        fetchedAttachmentUrls.add(exKey);
        const ex21Body = await fetchSecDocument(ex21Url);
        if (ex21Body && ex21Body.length > 80) {
          const fromEx21 = extractSubsidiaryNamesFromStandaloneExhibitBody(ex21Body, L.ex21, comprehensive, appendDom);
          for (const n of fromEx21) pushName(n);
          if (fromEx21.length > 0) {
            sources.push(`10-K Exhibit 21 — separate SEC file (${aligned.filingDate}, same accession as ingest)`);
          }
        }
      }
    }

    const disclaimer =
      "Registrant name plus subsidiaries from your saved Subsidiary List (if any), from Exhibit 21 embedded in the latest 10-K primary document, links discovered in that HTML, and from the separate Exhibit 21 file in the SEC index when present. Verify matches on USPTO.";

    if (names.length === 0) {
      return {
        ok: false,
        message:
          "No entity-name patterns found. Save a subsidiary list on the Subsidiary List tab, or ensure SEC filings load for this ticker.",
      };
    }

    const registrant = companyName.replace(/\s+/g, " ").trim();
    const byKey = new Map<string, string>();
    for (const n of names) {
      byKey.set(n.toLowerCase(), n);
    }
    byKey.set(registrant.toLowerCase(), registrant);

    const ordered: string[] = [];
    const regKey = registrant.toLowerCase();
    if (byKey.has(regKey)) {
      ordered.push(byKey.get(regKey)!);
      byKey.delete(regKey);
    }
    const rest = Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    return {
      ok: true,
      companyName: registrant,
      names: [...ordered, ...rest].slice(0, L.returnCap),
      sources: Array.from(new Set(sources)),
      disclaimer,
    };
  }

  const filingsResult = await getFilingsByTicker(t);
  if (filingsResult?.companyName) companyName = filingsResult.companyName.trim() || companyName;

  if (profile === "public-records" && filingsResult?.filings?.length && filingsResult.cik) {
    const tenK = pickLatestAnnualReport(filingsResult.filings);
    if (tenK?.accessionNumber && tenK.docUrl) {
      const ex21Url = await resolveBestExhibit21Url(t, filingsResult.cik, tenK);
      if (ex21Url) {
        const ex21Body = await fetchSecDocument(ex21Url);
        if (ex21Body && ex21Body.length > 80) {
          const fromEx21 = extractSubsidiaryNamesFromStandaloneExhibitBody(
            ex21Body,
            L.ex21,
            comprehensive,
            appendDom
          );
          for (const n of fromEx21) pushName(n);
          if (fromEx21.length > 0) {
            sources.push(`10-K Exhibit 21 — separate SEC file (${tenK.filingDate})`);
          }
        }
      }
    }
    if (names.length === 0 && filingsResult.filings.length > 0) {
      const primaryFiling = tenK ?? filingsResult.filings.find((f) => is10Q(f.form));
      if (primaryFiling?.docUrl) {
        const rawText = await fetchSecDocument(primaryFiling.docUrl);
        if (rawText && rawText.length > 500) {
          const fromFiling = extractSubsidiaryNamesFromFilingForHints(
            rawText,
            L.embedded,
            comprehensive,
            appendDom
          );
          for (const n of fromFiling) pushName(n);
          if (fromFiling.length > 0) {
            sources.push(
              `${primaryFiling.form} (${primaryFiling.filingDate}) — Exhibit 21 section embedded in primary document (no separate Exhibit 21 attachment)`
            );
          }
        }
      }
    }
    if (names.length === 0) {
      return {
        ok: false,
        message:
          "Could not read a subsidiary list from Exhibit 21. Open the latest annual report on SEC.gov and confirm Exhibit 21 is present.",
      };
    }
    return {
      ok: true,
      companyName,
      names: names.slice(0, L.returnCap),
      sources: Array.from(new Set(sources)),
      disclaimer:
        "Subsidiary names and domiciles are taken only from SEC Schedule Exhibit 21 in the latest annual filing (standalone attachment when present, otherwise the Exhibit 21 section in the primary HTML).",
    };
  }

  pushName(companyName);

  if (filingsResult?.filings?.length && filingsResult.cik) {
    const tenK = pickLatestAnnualReport(filingsResult.filings);
    const tenQ = filingsResult.filings.find((f) => is10Q(f.form));
    const primaryFiling = tenK ?? tenQ;

    const fetchedAttachmentUrls = new Set<string>();
    const primaryKey = primaryFiling?.docUrl ? normalizedHrefKey(primaryFiling.docUrl) : null;
    if (primaryKey) fetchedAttachmentUrls.add(primaryKey);

    if (primaryFiling?.docUrl) {
      const rawText = await fetchSecDocument(primaryFiling.docUrl);
      if (rawText && rawText.length > 500) {
        const fromFiling = extractSubsidiaryNamesFromFilingForHints(rawText, L.embedded, comprehensive, appendDom);
        for (const n of fromFiling) pushName(n);
        if (fromFiling.length > 0) {
          sources.push(
            `${primaryFiling.form} (${primaryFiling.filingDate}) — Exhibit 21 section embedded in primary document`
          );
        }
        await ingestSubsidiariesFromLinkedPrimaryPages(
          rawText,
          primaryFiling.docUrl,
          fetchedAttachmentUrls,
          `${primaryFiling.form} (${primaryFiling.filingDate})`,
          profile,
          L,
          comprehensive,
          appendDom,
          pushName,
          sources
        );
      }
    }

    if (tenK?.accessionNumber) {
      const ex21Url = await resolveBestExhibit21Url(t, filingsResult.cik, tenK);
      if (ex21Url) {
        const exKey = normalizedHrefKey(ex21Url);
        if (exKey && !fetchedAttachmentUrls.has(exKey)) {
          fetchedAttachmentUrls.add(exKey);
          const ex21Body = await fetchSecDocument(ex21Url);
          if (ex21Body && ex21Body.length > 80) {
            const fromEx21 = extractSubsidiaryNamesFromStandaloneExhibitBody(ex21Body, L.ex21, comprehensive, appendDom);
            for (const n of fromEx21) pushName(n);
            if (fromEx21.length > 0) {
              sources.push(`10-K Exhibit 21 — separate SEC file (${tenK.filingDate})`);
            }
          }
        }
      }
    }
  }

  const disclaimer =
    profile === "public-records"
      ? "Subsidiary names from your saved Subsidiary List (if any), from Exhibit 21 embedded in the 10-K/10-Q primary document when present, and from the separate Exhibit 21 index attachment. Extraction is automated and may miss unusual rows or pick up headers—compare to the official SEC exhibit for a complete list."
      : "Registrant name plus subsidiaries from your saved Subsidiary List (if any), from Exhibit 21 when it appears inside the 10-K HTML, and—when available—from the separate Exhibit 21 file listed in the SEC filing index (typical for large filers). Verify matches on USPTO.";

  if (names.length === 0) {
    return {
      ok: false,
      message:
        "No entity-name patterns found. Save a subsidiary list on the Subsidiary List tab, or ensure SEC filings load for this ticker.",
    };
  }

  const registrant = companyName.replace(/\s+/g, " ").trim();
  const byKey = new Map<string, string>();
  for (const n of names) {
    byKey.set(n.toLowerCase(), n);
  }
  byKey.set(registrant.toLowerCase(), registrant);

  const ordered: string[] = [];
  const regKey = registrant.toLowerCase();
  if (byKey.has(regKey)) {
    ordered.push(byKey.get(regKey)!);
    byKey.delete(regKey);
  }
  const rest = Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return {
    ok: true,
    companyName: registrant,
    names: [...ordered, ...rest].slice(0, L.returnCap),
    sources: Array.from(new Set(sources)),
    disclaimer,
  };
}
