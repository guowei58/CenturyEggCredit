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
import { resolveExhibit21DocumentUrl } from "@/lib/sec-filing-exhibits";
import { getFilingsByTicker } from "@/lib/sec-edgar";

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

function is10K(form: string): boolean {
  const u = form.trim().toUpperCase();
  return u === "10-K" || u === "10-K/A";
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

export async function getSubsidiaryHintsForTicker(
  ticker: string,
  userId?: string | null
): Promise<SubsidiaryHintsResult> {
  const t = ticker?.trim();
  if (!t) return { ok: false, message: "Ticker required" };

  const sources: string[] = [];
  const names: string[] = [];
  const seenLower = new Set<string>();

  function pushName(name: string) {
    const n = name.replace(/\s+/g, " ").trim();
    if (n.length < 2 || n.length > 130) return;
    const k = n.toLowerCase();
    if (seenLower.has(k)) return;
    seenLower.add(k);
    names.push(n);
  }

  let companyName = t.toUpperCase();

  const saved = await readSavedContent(t, "subsidiary-list", userId);
  if (saved && saved.trim().length > 120) {
    const fromSaved = parseSubsidiaryNamesFromSavedMarkdown(saved, 32);
    if (fromSaved.length > 0) {
      for (const n of fromSaved) pushName(n);
      sources.push('Saved "Subsidiary List" tab (markdown tables / bullets)');
    }
  }

  const filingsResult = await getFilingsByTicker(t);
  if (filingsResult?.companyName) companyName = filingsResult.companyName.trim() || companyName;

  pushName(companyName);

  if (filingsResult?.filings?.length && filingsResult.cik) {
    const tenK = filingsResult.filings.find((f) => is10K(f.form));
    const tenQ = filingsResult.filings.find((f) => is10Q(f.form));
    const primaryFiling = tenK ?? tenQ;
    if (primaryFiling?.docUrl) {
      const rawText = await fetchSecDocument(primaryFiling.docUrl);
      if (rawText && rawText.length > 500) {
        const fromFiling = extractSubsidiaryNamesFromFilingForHints(rawText, 28);
        for (const n of fromFiling) pushName(n);
        if (fromFiling.length > 0) {
          sources.push(
            `${primaryFiling.form} (${primaryFiling.filingDate}) — Exhibit 21 section embedded in primary document`
          );
        }
      }
    }

    if (tenK?.accessionNumber) {
      const ex21Url = await resolveExhibit21DocumentUrl(filingsResult.cik, tenK.accessionNumber);
      if (ex21Url) {
        const ex21Body = await fetchSecDocument(ex21Url);
        if (ex21Body && ex21Body.length > 80) {
          const fromEx21 = extractSubsidiaryNamesFromStandaloneExhibitBody(ex21Body, 48);
          for (const n of fromEx21) pushName(n);
          if (fromEx21.length > 0) {
            sources.push(`10-K Exhibit 21 — separate SEC file (${tenK.filingDate})`);
          }
        }
      }
    }
  }

  const disclaimer =
    "Registrant name plus subsidiaries from your saved Subsidiary List (if any), from Exhibit 21 when it appears inside the 10-K HTML, and—when available—from the separate Exhibit 21 file listed in the SEC filing index (typical for large filers). Verify matches on USPTO.";

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
    names: [...ordered, ...rest].slice(0, 36),
    sources: Array.from(new Set(sources)),
    disclaimer,
  };
}
