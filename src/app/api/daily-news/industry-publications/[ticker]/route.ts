import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { getCompanyProfile } from "@/lib/sec-edgar";
import {
  customPublicationInputsFromUrls,
  MAX_CUSTOM_INDUSTRY_PUBLICATIONS,
  parsePublicationUrl,
  readCustomIndustryPublications,
  resetCustomIndustryPublicationsToAuto,
  resolveIndustryPublicationsForDigest,
  writeCustomIndustryPublications,
} from "@/lib/daily-news/custom-publications";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let companyName = sym;
  let sic = "";
  let sicDescription = "";
  let formerNames: string[] = [];
  try {
    const profile = await getCompanyProfile(sym);
    if (profile) {
      companyName = profile.name;
      sic = profile.sic;
      sicDescription = profile.sicDescription;
      formerNames = profile.formerNames;
    }
  } catch {
    /* profile optional */
  }

  const resolution = await resolveIndustryPublicationsForDigest({
    userId,
    ticker: sym,
    companyName,
    sicRaw: sic,
    sicDescription,
    formerNames,
  });

  return NextResponse.json({
    ticker: sym,
    companyName,
    mode: resolution.mode,
    maxCustom: MAX_CUSTOM_INDUSTRY_PUBLICATIONS,
    customPublications: resolution.customPublications,
    autoPublications: resolution.autoPublications,
    effectivePublications: resolution.publications,
  });
}

type PutBody = {
  publications?: Array<{ url?: string; name?: string | null }>;
};

export async function PUT(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const inputs = Array.isArray(body.publications) ? body.publications : [];
  if (inputs.length > MAX_CUSTOM_INDUSTRY_PUBLICATIONS) {
    return NextResponse.json(
      { error: `At most ${MAX_CUSTOM_INDUSTRY_PUBLICATIONS} custom publications allowed` },
      { status: 400 }
    );
  }

  const nonEmpty = inputs.filter((row) => (row.url ?? "").trim().length > 0);
  for (const row of nonEmpty) {
    const parsed = parsePublicationUrl(row.url ?? "");
    if (!parsed) {
      return NextResponse.json({ error: `Could not parse publication URL: ${row.url}` }, { status: 400 });
    }
  }

  const parsed = customPublicationInputsFromUrls(
    inputs.map((row) => ({ url: row.url ?? "", name: row.name ?? null }))
  );

  const saved = await writeCustomIndustryPublications(userId, sym, parsed);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  const customPublications = await readCustomIndustryPublications(userId, sym);

  let companyName = sym;
  let sic = "";
  let sicDescription = "";
  let formerNames: string[] = [];
  try {
    const profile = await getCompanyProfile(sym);
    if (profile) {
      companyName = profile.name;
      sic = profile.sic;
      sicDescription = profile.sicDescription;
      formerNames = profile.formerNames;
    }
  } catch {
    /* optional */
  }

  const resolution = await resolveIndustryPublicationsForDigest({
    userId,
    ticker: sym,
    companyName,
    sicRaw: sic,
    sicDescription,
    formerNames,
  });

  return NextResponse.json({
    ok: true,
    ticker: sym,
    mode: resolution.mode,
    customPublications,
    effectivePublications: resolution.publications,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const saved = await resetCustomIndustryPublicationsToAuto(userId, sym);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode: "auto" });
}
