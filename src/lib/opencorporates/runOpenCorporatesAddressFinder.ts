import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeAddress } from "@/lib/entityNormalize";
import { mapExhibitJurisdictionToOpenCorporates } from "@/config/opencorporatesJurisdictionMap";
import { openCorporatesCodeToGleifJurisdiction } from "@/lib/gleif/openCorporatesCodeToGleifJurisdiction";
import { searchGleifLeiRecords } from "@/lib/gleif/searchGleifLeiRecords";
import {
  pickBestHits,
  scoreOpenCorporatesCandidate,
  type ScoredHit,
} from "@/lib/opencorporates/scoreOpenCorporatesMatch";
import type { OpenCorporatesCompanyHit } from "@/lib/opencorporates/types";
import { normalizeSubsidiaryNameForOpenCorporates } from "@/lib/opencorporates/subsidiaryNameNormalize";
import { subsidiaryTableRowsFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";

function cacheKeyPart(opts: {
  ticker: string;
  cik: string | null;
  query: string;
  jurisdictionFilter: string | null;
  mode: "gleif";
}): string {
  return `${opts.ticker}|${opts.cik ?? ""}|${opts.query}|${opts.jurisdictionFilter ?? "NONE"}|${opts.mode}`;
}

export function computeOpenCorporatesCacheKey(opts: Parameters<typeof cacheKeyPart>[0]): string {
  return createHash("sha256").update(cacheKeyPart(opts), "utf8").digest("hex");
}

function cacheFresh(responseAt: Date, maxCacheAgeDays: number): boolean {
  const ms = maxCacheAgeDays * 86_400_000;
  return Date.now() - responseAt.getTime() < ms;
}

type Strategy = { query: string; jurisdiction: string | null; label: string };

function buildStrategies(exactLegal: string, gleifJurisdiction: string | null): Strategy[] {
  const exactTrim = exactLegal.trim();
  const normalizedQ = normalizeSubsidiaryNameForOpenCorporates(exactLegal);
  const out: Strategy[] = [];
  if (gleifJurisdiction) {
    out.push({ query: exactTrim, jurisdiction: gleifJurisdiction, label: "exact+jurisdiction" });
    if (normalizedQ !== exactTrim.toLowerCase()) {
      out.push({ query: normalizedQ, jurisdiction: gleifJurisdiction, label: "normalized+jurisdiction" });
    }
  }
  out.push({ query: exactTrim, jurisdiction: null, label: "exact+global" });
  if (normalizedQ !== exactTrim.toLowerCase()) {
    out.push({ query: normalizedQ, jurisdiction: null, label: "normalized+global" });
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.query}\n${s.jurisdiction ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function resolveCompaniesFromCacheOrNetwork(params: {
  prisma: PrismaClient;
  userId: string;
  ticker: string;
  cik: string | null;
  normalizedSubsidiaryName: string;
  strategy: Strategy;
  forceRefresh: boolean;
  maxCacheAgeDays: number;
}): Promise<
  | {
      ok: true;
      companies: OpenCorporatesCompanyHit[];
      meta: {
        apiEndpoint: string;
        query: string;
        jurisdictionFilter: string | null;
        responseAt: string;
        resultCount: number;
        raw: Record<string, unknown>;
      };
      fromCache: boolean;
      cacheRowId?: string;
    }
  | { ok: false; fatal?: boolean; message: string; status?: number }
> {
  const cacheKey = computeOpenCorporatesCacheKey({
    ticker: params.ticker,
    cik: params.cik,
    query: params.strategy.query,
    jurisdictionFilter: params.strategy.jurisdiction,
    mode: "gleif",
  });

  if (!params.forceRefresh) {
    const cached = await params.prisma.openCorporatesApiCacheEntry.findUnique({
      where: { userId_cacheKey: { userId: params.userId, cacheKey } },
    });
    if (
      cached &&
      !cached.errorText &&
      cacheFresh(cached.responseAt, params.maxCacheAgeDays)
    ) {
      const raw = cached.rawResponseJson as Record<string, unknown>;
      const companies = (cached.selectedResultJson as { companies?: OpenCorporatesCompanyHit[] } | null)?.companies;
      if (companies?.length) {
        return {
          ok: true,
          companies,
          meta: {
            apiEndpoint: cached.apiEndpoint,
            query: cached.queryUsed,
            jurisdictionFilter: cached.jurisdictionFilter || null,
            responseAt: cached.responseAt.toISOString(),
            resultCount: cached.resultCount,
            raw,
          },
          fromCache: true,
          cacheRowId: cached.id,
        };
      }
    }
  }

  const gleif = await searchGleifLeiRecords({
    legalName: params.strategy.query,
    gleifJurisdiction: params.strategy.jurisdiction,
    pageSize: 50,
  });

  if (!gleif.ok) {
    await params.prisma.openCorporatesApiCacheEntry.upsert({
      where: { userId_cacheKey: { userId: params.userId, cacheKey } },
      create: {
        userId: params.userId,
        ticker: params.ticker,
        cik: params.cik,
        cacheKey,
        normalizedSubsidiaryName: params.normalizedSubsidiaryName,
        jurisdictionFilter: params.strategy.jurisdiction ?? "",
        queryUsed: params.strategy.query,
        apiEndpoint: "",
        responseAt: new Date(),
        resultCount: 0,
        rawResponseJson: { error: gleif.bodySnippet } as object,
        errorText: gleif.bodySnippet.slice(0, 2000),
      },
      update: {
        errorText: gleif.bodySnippet.slice(0, 2000),
        responseAt: new Date(),
      },
    });
    return { ok: false, message: gleif.bodySnippet.slice(0, 400), status: gleif.status };
  }

  await params.prisma.openCorporatesApiCacheEntry.upsert({
    where: { userId_cacheKey: { userId: params.userId, cacheKey } },
    create: {
      userId: params.userId,
      ticker: params.ticker,
      cik: params.cik,
      cacheKey,
      normalizedSubsidiaryName: params.normalizedSubsidiaryName,
      jurisdictionFilter: params.strategy.jurisdiction ?? "",
      queryUsed: params.strategy.query,
      apiEndpoint: gleif.meta.apiEndpoint,
      responseAt: new Date(gleif.meta.responseAt),
      resultCount: gleif.meta.resultCount,
      rawResponseJson: gleif.meta.raw as object,
      selectedResultJson: { companies: gleif.companies } as object,
      errorText: null,
    },
    update: {
      rawResponseJson: gleif.meta.raw as object,
      selectedResultJson: { companies: gleif.companies } as object,
      resultCount: gleif.meta.resultCount,
      responseAt: new Date(gleif.meta.responseAt),
      errorText: null,
    },
  });

  return {
    ok: true,
    companies: gleif.companies,
    meta: {
      apiEndpoint: gleif.meta.apiEndpoint,
      query: gleif.meta.query,
      jurisdictionFilter: gleif.meta.jurisdictionFilter,
      responseAt: gleif.meta.responseAt,
      resultCount: gleif.meta.resultCount,
      raw: gleif.meta.raw,
    },
    fromCache: false,
  };
}

function resultStatusLabel(scored: ScoredHit | null, ambiguous: boolean): string {
  if (!scored) return "No reliable match";
  if (!scored.namePlausible || scored.matchConfidence === "low") return "No reliable match";
  if (ambiguous) return "Ambiguous — review required";
  if (scored.matchConfidence === "high") return "Found — high confidence";
  if (scored.matchConfidence === "medium") return "Found — medium confidence";
  return "No reliable match";
}

export async function runOpenCorporatesAddressFinder(opts: {
  prisma: PrismaClient;
  userId: string;
  ticker: string;
  forceRefresh: boolean;
  maxCacheAgeDays: number;
}): Promise<{
  ok: boolean;
  error?: string;
  skippedReason?: string;
  stats?: { subsidiaries: number; source: "gleif_api" };
}> {
  const tk = opts.ticker.trim().toUpperCase();

  const profile = await opts.prisma.publicRecordsProfile.findUnique({
    where: { userId_ticker: { userId: opts.userId, ticker: tk } },
  });

  if (!profile) {
    return { ok: false, error: "Public Records profile not found — save the profile under Overview first." };
  }

  const rows = subsidiaryTableRowsFromSavedProfile(
    profile.subsidiaryExhibit21Snapshot,
    profile.subsidiaryNames,
    profile.subsidiaryDomiciles
  ).filter((r) => r.name.trim().length >= 2);

  if (rows.length === 0) {
    return { ok: false, skippedReason: "No Exhibit 21 subsidiaries found on the Public Records profile." };
  }

  const parentCompanyName = profile.companyName ?? null;
  const cik = profile.cik ?? null;
  const mapDomToOc = (dom: string) => mapExhibitJurisdictionToOpenCorporates(dom);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const exhibitLegalName = row.name.trim();
    const exhibitJurisdictionText = row.domicile.trim();
    const normalizedExhibit = normalizeSubsidiaryNameForOpenCorporates(exhibitLegalName);
    const mapped = mapDomToOc(exhibitJurisdictionText);
    const exhibitLeiJurisdiction =
      mapped.kind === "mapped" ? openCorporatesCodeToGleifJurisdiction(mapped.ocCode) : null;

    const strategies = buildStrategies(exhibitLegalName, exhibitLeiJurisdiction);

    let chosen: ScoredHit | null = null;
    let lastMeta: { raw: Record<string, unknown>; query: string } | null = null;
    let ambiguous = false;
    let ambiguousCandidates: ScoredHit[] | null = null;

    for (const strategy of strategies) {
      const resolved = await resolveCompaniesFromCacheOrNetwork({
        prisma: opts.prisma,
        userId: opts.userId,
        ticker: tk,
        cik,
        normalizedSubsidiaryName: normalizedExhibit,
        strategy,
        forceRefresh: opts.forceRefresh,
        maxCacheAgeDays: opts.maxCacheAgeDays,
      });

      if (!resolved.ok) {
        if ("fatal" in resolved && resolved.fatal) {
          return { ok: false, error: resolved.message };
        }
        continue;
      }

      lastMeta = { raw: resolved.meta.raw, query: resolved.meta.query };

      const ambPool =
        resolved.companies.length > 8 ||
        (resolved.meta.resultCount > 25 && resolved.companies.length > 3);
      const scored = pickBestHits(
        exhibitLegalName,
        exhibitLeiJurisdiction,
        normalizedExhibit,
        resolved.companies,
        { ambiguousPool: ambPool }
      );

      if (scored.length >= 2 && scored[0] && scored[1]) {
        if (
          scored[0].namePlausible &&
          scored[1].namePlausible &&
          Math.abs(scored[0].score - scored[1].score) < 18 &&
          scored[0].score < 110
        ) {
          ambiguous = true;
          ambiguousCandidates = scored.slice(0, 5);
          chosen = scoreOpenCorporatesCandidate({
            exhibitLegalName,
            exhibitLeiJurisdiction,
            normalizedExhibitName: normalizedExhibit,
            hit: scored[0].hit,
            searchHadJurisdictionFilter: Boolean(strategy.jurisdiction),
            ambiguousPool: ambPool,
          });
          break;
        }
      }

      if (scored[0]) {
        const top = scoreOpenCorporatesCandidate({
          exhibitLegalName,
          exhibitLeiJurisdiction,
          normalizedExhibitName: normalizedExhibit,
          hit: scored[0].hit,
          searchHadJurisdictionFilter: Boolean(strategy.jurisdiction),
          ambiguousPool: ambPool,
        });

        if (top.matchConfidence === "high" || top.matchConfidence === "medium") {
          chosen = top;
          break;
        }
        if (!chosen || top.score > chosen.score) {
          chosen = top;
        }
      }
    }

    /** Do not persist unrelated LEIs that only matched on jurisdiction / address. */
    const rowChosen = chosen?.namePlausible ? chosen : null;

    const addrRaw = rowChosen?.hit.registered_address_in_full?.trim() ?? "";
    const normAddr = addrRaw ? normalizeAddress(addrRaw).normalized : "";

    const autoFillAddress =
      rowChosen &&
      (rowChosen.matchConfidence === "high" || rowChosen.matchConfidence === "medium") &&
      addrRaw.length > 8;

    const notesParts: string[] = [];
    if (mapped.kind === "unmapped" && exhibitJurisdictionText) {
      notesParts.push(
        "Exhibit jurisdiction not mapped to ISO/GLEIF region — confidence reduced; searched without jurisdiction filter."
      );
    }
    notesParts.push(
      "GLEIF holds Legal Entity Identifiers (LEI) — subsidiaries without an LEI will not appear. Address is GLEIF legal address (not asserted as HQ)."
    );
    if (chosen && !chosen.namePlausible) {
      notesParts.push(
        `Rejected top API hit (“${chosen.hit.name}”) — legal name did not match the Exhibit subsidiary name.`
      );
    }
    if (rowChosen?.breakdown?.length) {
      notesParts.push(`Scoring: ${rowChosen.breakdown.join("; ")}`);
    }

    const resultStatus = !rowChosen
      ? "No reliable match"
      : ambiguous
        ? "Ambiguous — review required"
        : resultStatusLabel(rowChosen, false);

    await opts.prisma.openCorporatesSubsidiaryAddressResult.upsert({
      where: {
        userId_ticker_subsidiaryRowIndex: {
          userId: opts.userId,
          ticker: tk,
          subsidiaryRowIndex: i,
        },
      },
      create: {
        userId: opts.userId,
        ticker: tk,
        cik,
        parentCompanyName,
        subsidiaryRowIndex: i,
        exhibitLegalName,
        exhibitJurisdiction: exhibitJurisdictionText || null,
        entityType: null,
        sourceFiling: "Public Records profile — Exhibit 21 subsidiary schedule",
        filingDate: null,
        searchQueryUsed: lastMeta?.query ?? strategies[0]?.query ?? exhibitLegalName,
        matchedName: rowChosen?.hit.name ?? null,
        ocJurisdiction: rowChosen?.hit.jurisdiction_code ?? null,
        companyNumber: rowChosen?.hit.company_number ?? null,
        companyStatus: rowChosen?.hit.current_status ?? null,
        registeredAddress: addrRaw.length > 8 ? addrRaw : null,
        rawAddress: addrRaw || null,
        normalizedAddress: normAddr || null,
        addressConfidence: autoFillAddress ? rowChosen?.addressConfidence ?? null : rowChosen?.addressConfidence ?? null,
        matchConfidence: autoFillAddress ? rowChosen?.matchConfidence ?? null : rowChosen?.matchConfidence ?? null,
        ocUrl: rowChosen?.hit.opencorporates_url ?? null,
        registryUrl: rowChosen?.hit.registry_url ?? null,
        retrievalTimestamp: new Date(),
        resultStatus,
        notes: notesParts.join(" ") || null,
        topCandidatesJson:
          ambiguous && ambiguousCandidates?.length
            ? (ambiguousCandidates.map((s) => ({
                name: s.hit.name,
                jurisdiction_code: s.hit.jurisdiction_code,
                company_number: s.hit.company_number,
                score: s.score,
                gleif_record_url: s.hit.opencorporates_url,
              })) as unknown as object)
            : undefined,
        rawSearchResponseJson: lastMeta?.raw as object | undefined,
      },
      update: {
        cik,
        parentCompanyName,
        exhibitLegalName,
        exhibitJurisdiction: exhibitJurisdictionText || null,
        searchQueryUsed: lastMeta?.query ?? strategies[0]?.query ?? exhibitLegalName,
        matchedName: rowChosen?.hit.name ?? null,
        ocJurisdiction: rowChosen?.hit.jurisdiction_code ?? null,
        companyNumber: rowChosen?.hit.company_number ?? null,
        companyStatus: rowChosen?.hit.current_status ?? null,
        registeredAddress: addrRaw.length > 8 ? addrRaw : null,
        rawAddress: addrRaw || null,
        normalizedAddress: normAddr || null,
        addressConfidence: autoFillAddress ? rowChosen?.addressConfidence ?? null : rowChosen?.addressConfidence ?? null,
        matchConfidence: autoFillAddress ? rowChosen?.matchConfidence ?? null : rowChosen?.matchConfidence ?? null,
        ocUrl: rowChosen?.hit.opencorporates_url ?? null,
        registryUrl: rowChosen?.hit.registry_url ?? null,
        retrievalTimestamp: new Date(),
        resultStatus,
        notes: notesParts.join(" ") || null,
        topCandidatesJson:
          ambiguous && ambiguousCandidates?.length
            ? (ambiguousCandidates.map((s) => ({
                name: s.hit.name,
                jurisdiction_code: s.hit.jurisdiction_code,
                company_number: s.hit.company_number,
                score: s.score,
                gleif_record_url: s.hit.opencorporates_url,
              })) as unknown as object)
            : undefined,
        rawSearchResponseJson: lastMeta?.raw as object | undefined,
      },
    });
  }

  return {
    ok: true,
    stats: { subsidiaries: rows.length, source: "gleif_api" },
  };
}
