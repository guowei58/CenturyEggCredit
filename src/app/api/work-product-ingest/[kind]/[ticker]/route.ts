import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { collectCreativeWorkspaceRawDocuments } from "@/lib/creative-workspace-sources";
import { collectCsRecommendationRawDocuments } from "@/lib/cs-recommendation-sources";
import { collectForensicWorkspaceRawDocuments } from "@/lib/forensic-workspace-sources";
import { collectKpiCommentaryRawDocuments } from "@/lib/kpi-workspace-sources";
import { collectLmeRawDocuments, type LmeRawDocument } from "@/lib/lme-sources";
import {
  applyPendingUserAddedSourceIds,
  buildWorkProductIngestCatalog,
  isWorkProductIngestTabKind,
  validateUserAddedSourceIdsForKind,
  writePendingUserAddedSourceIds,
  type WorkProductIngestTabKind,
} from "@/lib/work-product-ingest-additions";

export const dynamic = "force-dynamic";

async function collectDefaultRawDocuments(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string
): Promise<LmeRawDocument[]> {
  switch (kind) {
    case "kpi":
      return collectKpiCommentaryRawDocuments(ticker, userId);
    case "lme":
      return collectLmeRawDocuments(ticker, userId);
    case "forensic":
      return collectForensicWorkspaceRawDocuments(ticker, userId);
    case "recommendation":
      return collectCsRecommendationRawDocuments(ticker, userId);
    case "literary":
    case "biblical":
    case "dumbass":
    case "earnings-transcript":
      return collectCreativeWorkspaceRawDocuments("other-memos", ticker, userId);
    case "memo":
      return [];
    default:
      return [];
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; ticker: string }> }
) {
  const { kind: kindRaw, ticker } = await params;
  const kind = kindRaw?.trim().toLowerCase();
  if (!isWorkProductIngestTabKind(kind)) {
    return NextResponse.json({ error: "Invalid work product kind" }, { status: 400 });
  }

  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage ingestion sources." }, { status: 401 });
  }

  const baseDocs = await collectDefaultRawDocuments(kind, sym, userId);
  const catalog = await buildWorkProductIngestCatalog(kind, sym, userId, baseDocs);
  return NextResponse.json({ ok: true, catalog });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ kind: string; ticker: string }> }
) {
  const { kind: kindRaw, ticker } = await params;
  const kind = kindRaw?.trim().toLowerCase();
  if (!isWorkProductIngestTabKind(kind)) {
    return NextResponse.json({ error: "Invalid work product kind" }, { status: 400 });
  }

  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage ingestion sources." }, { status: 401 });
  }

  let body: { addedSourceIds?: unknown };
  try {
    body = (await request.json()) as { addedSourceIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.addedSourceIds)) {
    return NextResponse.json({ error: "addedSourceIds must be an array" }, { status: 400 });
  }

  const baseDocs = await collectDefaultRawDocuments(kind, sym, userId);
  const catalog = await buildWorkProductIngestCatalog(kind, sym, userId, baseDocs);
  const validated = validateUserAddedSourceIdsForKind(
    kind,
    catalog,
    body.addedSourceIds.filter((id): id is string => typeof id === "string")
  );

  const saved = await writePendingUserAddedSourceIds(kind, sym, userId, validated);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  const nextCatalog = await buildWorkProductIngestCatalog(kind, sym, userId, baseDocs);
  return NextResponse.json({ ok: true, catalog: nextCatalog });
}

/** Apply saved picker selections to this tab's ingested source set (call from Refresh sources). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ kind: string; ticker: string }> }
) {
  const { kind: kindRaw, ticker } = await params;
  const kind = kindRaw?.trim().toLowerCase();
  if (!isWorkProductIngestTabKind(kind)) {
    return NextResponse.json({ error: "Invalid work product kind" }, { status: 400 });
  }

  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage ingestion sources." }, { status: 401 });
  }

  const applied = await applyPendingUserAddedSourceIds(kind, sym, userId);
  if (!applied.ok) {
    return NextResponse.json({ error: applied.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    appliedSourceIds: applied.applied,
    unchanged: applied.unchanged,
  });
}
