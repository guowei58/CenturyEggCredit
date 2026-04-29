import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/sec-edgar";
import {
  formatOdpPatentQueryString,
  patentNumberToGooglePatentsUrl,
  searchOdpPatentApplications,
  searchPatentsViewAssignees,
  searchPatentsViewPatentsByAssignee,
  unwrapOdpStylePhrase,
} from "@/lib/uspto-ip";

export const dynamic = "force-dynamic";

const ODP_URL = "https://data.uspto.gov/apis/getting-started";
const PV_URL = "https://patentsview.org/apis/purpose";
const TSDR_URL = "https://developer.uspto.gov";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: raw } = await params;
  const ticker = raw?.trim() ?? "";
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Ticker required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const qOverride = searchParams.get("q")?.trim() || "";
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const pvTop = Math.min(15, Math.max(1, parseInt(searchParams.get("pvTop") ?? "5", 10) || 5));
  const pvPatentsPer = Math.min(25, Math.max(5, parseInt(searchParams.get("pvPer") ?? "15", 10) || 15));

  const odpKey = process.env.USPTO_API_KEY?.trim();
  const pvKey = process.env.USPTO_PATENTSVIEW_API_KEY?.trim();

  let companyName: string | null = null;
  try {
    const profile = await getCompanyProfile(ticker);
    companyName = profile?.name ?? null;
  } catch {
    companyName = null;
  }

  const queryRaw = qOverride || companyName || ticker;
  /** ODP Lucene: phrase-quoted so tokens like INC./CORP don’t match every application. */
  const queryOdp = formatOdpPatentQueryString(queryRaw);
  /** PatentsView `_text_phrase` uses plain text (strip outer `"` if present). */
  const queryPatentsView = unwrapOdpStylePhrase(queryRaw);

  if (!odpKey) {
    return NextResponse.json({
      ok: true,
      ticker,
      companyName,
      queryUsed: queryOdp,
      odpConfigured: false,
      patentsViewConfigured: Boolean(pvKey),
      totalOdp: 0,
      odpPatents: [],
      assigneeCandidates: [],
      patentsViewBlocks: [],
      links: {
        odpSignup: ODP_URL,
        patentsViewSignup: PV_URL,
        tsdrSignup: TSDR_URL,
        trademarkSearchUi: "https://www.uspto.gov/trademarks/search",
        patentCenter: "https://patentcenter.uspto.gov/",
      },
      notices: [
        `Add USPTO_API_KEY to .env.local (free key: ${ODP_URL}) to search patent applications via the USPTO Open Data Portal.`,
      ],
      totalTrademarkOdp: 0,
      odpTrademarkOffset: 0,
      odpTrademarkLimit: limit,
      odpTrademarks: [],
    });
  }

  try {
    const { total, hits } = await searchOdpPatentApplications(odpKey, queryOdp, offset, limit);

    const odpPatents = hits.map((h) => ({
      ...h,
      googlePatentsUrl: patentNumberToGooglePatentsUrl(h.patentNumber),
    }));

    let assigneeCandidates: Array<{
      assigneeId: string | null;
      organization: string | null;
      totalPatents: number | null;
    }> = [];
    let patentsViewBlocks: Array<{
      assigneeOrganization: string;
      totalPatentsReported: number | null;
      patents: Array<{
        patentId: string | null;
        title: string | null;
        patentDate: string | null;
        assignees: string[];
        googlePatentsUrl: string | null;
      }>;
    }> = [];

    let patentsViewError: string | undefined;
    if (pvKey) {
      try {
        assigneeCandidates = await searchPatentsViewAssignees(pvKey, queryPatentsView, pvTop);
        const topOrgs = assigneeCandidates
          .map((a) => a.organization)
          .filter((o): o is string => Boolean(o?.trim()))
          .slice(0, 3);

        for (const org of topOrgs) {
          const patents = await searchPatentsViewPatentsByAssignee(pvKey, org, pvPatentsPer);
          const assigneeRow = assigneeCandidates.find((c) => c.organization === org);
          patentsViewBlocks.push({
            assigneeOrganization: org,
            totalPatentsReported: assigneeRow?.totalPatents ?? null,
            patents: patents.map((p) => ({
              ...p,
              googlePatentsUrl: p.patentId ? patentNumberToGooglePatentsUrl(p.patentId) : null,
            })),
          });
        }
      } catch (pvErr) {
        assigneeCandidates = [];
        patentsViewBlocks = [];
        patentsViewError = pvErr instanceof Error ? pvErr.message : "PatentsView request failed.";
      }
    }

    /** Same ODP key as patents; USPTO does not publish a working `.../trademark/.../search` route on api.uspto.gov. */
    const totalTrademarkOdp = 0;
    const odpTrademarks: Array<{
      serialNumber: string | null;
      registrationNumber: string | null;
      markText: string | null;
      statusLabel: string | null;
      filingDate: string | null;
      ownerName: string | null;
      tsdrUrl: string | null;
    }> = [];

    const notices: string[] = [];
    if (patentsViewError) {
      notices.push(`PatentsView enrichment failed (${patentsViewError}); ODP results are unchanged.`);
    }

    return NextResponse.json({
      ok: true,
      ticker,
      companyName,
      queryUsed: queryOdp,
      odpConfigured: true,
      patentsViewConfigured: Boolean(pvKey),
      patentsViewError,
      totalOdp: total,
      odpOffset: offset,
      odpLimit: limit,
      totalTrademarkOdp,
      odpTrademarkOffset: offset,
      odpTrademarkLimit: limit,
      odpTrademarks,
      odpPatents,
      assigneeCandidates,
      patentsViewBlocks,
      links: {
        odpSignup: ODP_URL,
        patentsViewSignup: PV_URL,
        tsdrSignup: TSDR_URL,
        trademarkSearchUi: "https://www.uspto.gov/trademarks/search",
        patentCenter: "https://patentcenter.uspto.gov/",
      },
      notices,
    });
  } catch (e) {
    console.error("USPTO IP search error:", e);
    const message = e instanceof Error ? e.message : "USPTO search failed.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        ticker,
        companyName,
        queryAttempted: queryOdp,
        odpSignup: ODP_URL,
      },
      { status: 502 }
    );
  }
}
