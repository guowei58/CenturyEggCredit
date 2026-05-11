import { NextResponse } from "next/server";
import { requireUserTicker } from "../_helpers";
import { getRegulatorySource } from "@/lib/regulatory/registry";
import { runRegulatorySearch } from "@/lib/regulatory/runSearch";
import type { RegulatorySearchParams } from "@/lib/regulatory/types";
import { workspaceWriteFile } from "@/lib/user-ticker-workspace-store";

type ReqBody = {
  sourceId: string;
  params: RegulatorySearchParams;
};

function safeJson(obj: unknown) {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

export async function POST(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await ctx.params;
  const auth = await requireUserTicker(raw);
  if ("error" in auth) return auth.error;
  const { userId, ticker } = auth;

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceId = String(body.sourceId ?? "").trim();
  const params = (body.params ?? { query: "" }) as RegulatorySearchParams;
  const src = getRegulatorySource(sourceId);
  if (!src) return NextResponse.json({ ok: false, error: "Unknown sourceId" }, { status: 400 });
  if (!params.query?.trim()) return NextResponse.json({ ok: false, error: "Query required" }, { status: 400 });

  const run = await runRegulatorySearch(sourceId, params);
  if (!run.ok) return NextResponse.json({ ok: false, error: run.error }, { status: 400 });

  const retrievedAt = new Date().toISOString();

  // Optional raw storage for auditability.
  let rawPath: string | undefined;
  if (params.saveRawResults) {
    rawPath = `regulatory/raw/${sourceId}/${retrievedAt.replace(/[:.]/g, "-")}.json`;
    const write = await workspaceWriteFile(userId, ticker, rawPath, Buffer.from(safeJson(run.response), "utf-8"));
    if (!write.ok) {
      // Keep going; return warning.
      rawPath = undefined;
    }
  }

  return NextResponse.json({
    ok: true,
    source: src,
    config: run.config,
    retrievedAt,
    rawStoragePath: rawPath,
    adapter: run.response,
  });
}

