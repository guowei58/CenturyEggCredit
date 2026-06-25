import { NextResponse } from "next/server";

import { resolveCompanySearchName } from "@/lib/company-search-context";
import { getSearchProviderFromEnv } from "@/lib/ratings-link-search/provider";
import { discoverRatingsLinksWithProvider } from "@/lib/ratings-link-search/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  let companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const aliasesRaw = Array.isArray(body.aliases) ? body.aliases : [];
  const aliases = aliasesRaw.filter((a): a is string => typeof a === "string").map((a) => a.trim());

  if (!companyName) {
    try {
      companyName = await resolveCompanySearchName(ticker);
    } catch (e) {
      console.error("ratings-links profile fetch:", e);
    }
  }

  const resolvedName = companyName || ticker;

  const prov = getSearchProviderFromEnv();
  if (!prov.ok) {
    return NextResponse.json(
      { error: prov.error.message, code: prov.error.code },
      { status: 503 }
    );
  }

  try {
    const data = await discoverRatingsLinksWithProvider(
      { ticker, companyName: resolvedName, aliases },
      prov.provider
    );
    return NextResponse.json(data);
  } catch (e) {
    console.error("ratings-links search:", e);
    const msg = e instanceof Error ? e.message : "Search failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
