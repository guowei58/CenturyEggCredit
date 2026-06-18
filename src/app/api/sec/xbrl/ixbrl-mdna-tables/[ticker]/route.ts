import { NextResponse } from "next/server";
import { buildIxbrlMdnaTablesBundle } from "@/lib/sec-ixbrl-mdna-tables-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

  try {
    const bundle = await buildIxbrlMdnaTablesBundle(sym, {
      accessionNumber: acc || undefined,
      includeUncertainBoundaries,
      includeLowConfidenceTables,
    });

    if (!bundle.ok) {
      const status =
        bundle.error === "SEC submissions not found for ticker"
          ? 404
          : bundle.error === "No 10-K/10-Q filings found"
            ? 404
            : bundle.error === "Filing has no primary document path"
              ? 400
              : 502;
      return NextResponse.json(bundle, { status });
    }

    return NextResponse.json(bundle);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Inline XBRL extraction failed";
    console.error("[ixbrl-mdna-tables]", sym, acc || "(latest)", message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        ticker: sym,
        mdnaHeadingFound: false,
        segmentHeadingFound: false,
        mdnaTableHit: false,
        mdnaSectionHtml: null,
        mdnaSectionHtmlTruncated: false,
        tables: [],
        ebitdaReconciliation: { status: "none", tables: [] },
        revenueDrivers: { status: "none", tables: [], revenueSectionFound: false },
      },
      { status: 500 }
    );
  }
}
