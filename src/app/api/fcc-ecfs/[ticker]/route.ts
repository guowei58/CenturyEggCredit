import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/sec-edgar";
import { getFccEcfsApiKey, searchEcfsFilings } from "@/lib/fcc-ecfs";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * GET /api/fcc-ecfs/[ticker]
 * Query: ?q=optional+override — ECFS full-text search string (default: SEC company name, else ticker).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const safeTicker = sanitizeTicker(rawTicker || "");
  if (!safeTicker) {
    return NextResponse.json({ ok: false, error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const url = new URL(request.url);
  const qOverride = url.searchParams.get("q")?.trim();

  const apiKey = getFccEcfsApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "FCC ECFS API key is not configured. Add FCC_API_KEY (or DATA_GOV_API_KEY) to .env.local — free at https://api.data.gov/signup",
        ecfs_help_url: "https://www.fcc.gov/ecfs/help/public_api",
        signup_url: "https://api.data.gov/signup",
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  let defaultQuery = safeTicker;
  let companyName: string | null = null;
  try {
    const profile = await getCompanyProfile(safeTicker);
    if (profile?.name?.trim()) {
      companyName = profile.name.trim();
      defaultQuery = companyName;
    }
  } catch {
    // keep ticker as default query
  }

  const searchQuery = qOverride && qOverride.length > 0 ? qOverride : defaultQuery;

  const result = await searchEcfsFilings({
    apiKey,
    query: searchQuery,
    limit: 50,
    offset: 0,
  });

  if (!result.ok) {
    const status = result.httpStatus === 403 || result.httpStatus === 401 ? 502 : 502;
    return NextResponse.json(
      { ok: false, error: result.error, query_attempted: searchQuery },
      { status, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      ticker: safeTicker,
      company_name: companyName,
      query_used: result.query_used,
      filings: result.filings,
      count: result.filings.length,
      ecfs_search_note:
        "Results come from the FCC ECFS public API keyword search (`q`). They may include filings that mention the company in the filing text, not only filings where the company is the named filer. Rows where the filer name contains your search string are sorted first.",
    },
    { headers: NO_STORE_HEADERS }
  );
}
