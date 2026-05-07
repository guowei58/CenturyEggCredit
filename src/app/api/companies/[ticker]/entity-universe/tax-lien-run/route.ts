import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runTaxLienWorkflow } from "@/lib/taxLien/runTaxLienWorkflow";
import { requireUserTicker } from "../_helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ClientSubsidiariesBody = {
  subsidiaryExhibit21Snapshot?: unknown;
  subsidiaryNames?: string[];
  subsidiaryDomiciles?: string[];
};

async function parseBody(req: Request): Promise<{
  nationalSweep: boolean;
  webFallbackEnabled: boolean;
  deepNameVariants: boolean;
  publicRecordsSubsidiaries: ClientSubsidiariesBody | null;
}> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return { nationalSweep: false, webFallbackEnabled: false, deepNameVariants: false, publicRecordsSubsidiaries: null };
  }
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return { nationalSweep: false, webFallbackEnabled: false, deepNameVariants: false, publicRecordsSubsidiaries: null };
  }
  const o = raw as Record<string, unknown>;
  const prs = o.publicRecordsSubsidiaries;
  let publicRecordsSubsidiaries: ClientSubsidiariesBody | null = null;
  if (prs && typeof prs === "object") {
    const p = prs as Record<string, unknown>;
    const names = p.subsidiaryNames;
    const doms = p.subsidiaryDomiciles;
    publicRecordsSubsidiaries = {
      subsidiaryExhibit21Snapshot: p.subsidiaryExhibit21Snapshot,
      subsidiaryNames: Array.isArray(names) ? names.map((x) => String(x ?? "")) : undefined,
      subsidiaryDomiciles: Array.isArray(doms) ? doms.map((x) => String(x ?? "")) : undefined,
    };
  }
  return {
    nationalSweep: o.nationalSweep === true,
    webFallbackEnabled: o.webFallbackEnabled === true,
    deepNameVariants: o.deepNameVariants === true,
    publicRecordsSubsidiaries,
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker: raw } = await params;
    const ctx = await requireUserTicker(raw);
    if ("error" in ctx) return ctx.error;
    const { userId, ticker } = ctx;

    const body = await parseBody(req);

    const result = await runTaxLienWorkflow({
      prisma,
      userId,
      ticker,
      nationalSweep: body.nationalSweep,
      webFallbackEnabled: body.webFallbackEnabled,
      deepNameVariants: body.deepNameVariants,
      publicRecordsSubsidiaries: body.publicRecordsSubsidiaries,
    });

    return NextResponse.json({
      ok: true,
      wiped: true,
      candidatesCreated: result.candidatesCreated,
      manualTasksCreated: result.manualTasksCreated,
      mergedEntities: result.mergedEntities,
      tasksCapped: result.tasksCapped,
      nationalSweep: body.nationalSweep,
      webFallbackEnabled: body.webFallbackEnabled,
      deepNameVariants: body.deepNameVariants,
      message:
        result.candidatesCreated === 0
          ? "No tax lien workflow candidates produced (no Exhibit 21 / profile / user-added entities)."
          : `Queued ${result.candidatesCreated} entity rows and ${result.manualTasksCreated} manual search tasks (${result.tasksCapped ? "task cap hit — expand MAX_MANUAL_TASKS_PER_RUN if needed" : "complete"}).`,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Tax lien workflow failed.";
    const msg = raw.includes("does not exist in the current database")
      ? `Database schema is missing tax lien tables. Apply migrations (\`prisma migrate deploy\`), then retry. Details: ${raw}`
      : raw;
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
