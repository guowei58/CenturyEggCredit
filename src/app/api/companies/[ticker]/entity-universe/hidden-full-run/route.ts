import { NextResponse } from "next/server";
import { requireUserTicker } from "../_helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  // Delegate to the two underlying workflows (credit-doc hidden entity + address clustering).
  // We intentionally keep them separate so each can be run independently and cached/triaged.
  const base = `/api/companies/${encodeURIComponent(ctx.ticker)}/entity-universe`;

  const [hiddenRes, addrRes] = await Promise.all([
    fetch(`${base}/hidden-missing-ex21`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ discoverDocuments: true, autoQueue: false, extractEntities: true, maxDocumentsToProcess: 24 }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) })),
    fetch(`${base}/address-cluster-run`, {
      method: "POST",
      credentials: "same-origin",
    }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) })),
  ]);

  if (!hiddenRes.ok) {
    return NextResponse.json(
      { ok: false, error: "Hidden-entity extraction step failed.", detail: hiddenRes.json, addr: addrRes.json },
      { status: 500 }
    );
  }

  if (!addrRes.ok) {
    return NextResponse.json(
      { ok: false, error: "Address cluster step failed.", hidden: hiddenRes.json, detail: addrRes.json },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    ticker: ctx.ticker,
    hidden: hiddenRes.json,
    addressClusters: addrRes.json,
  });
}

