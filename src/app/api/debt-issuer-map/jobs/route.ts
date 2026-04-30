import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { defaultDebtMapJobOptions, parseDebtMapJobOptions } from "@/lib/debt-map/runJob";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    companyInput?: string;
    ticker?: string | null;
    lookbackYears?: number;
    options?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companyInput = (body.companyInput ?? "").trim();
  if (!companyInput) return NextResponse.json({ error: "companyInput required" }, { status: 400 });

  const lookbackYears = Number.isFinite(body.lookbackYears) ? Math.max(1, Math.min(30, Number(body.lookbackYears))) : 10;
  const optionsJson = { ...defaultDebtMapJobOptions(), ...parseDebtMapJobOptions(body.options) };

  try {
    const job = await prisma.debtIssuerMapJob.create({
      data: {
        userId,
        companyInput,
        ticker: body.ticker?.trim() || null,
        lookbackYears,
        optionsJson,
        status: "pending",
      },
    });
    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    const msg = e instanceof Error ? e.message : "Database error";
    if (code === "P2021" || /does not exist|relation.*debt_issuer_map/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Debt mapper tables are missing. Run database migrations (e.g. npx prisma migrate deploy) so debt_issuer_map_jobs exists.",
        },
        { status: 503 }
      );
    }
    console.error("[debt-issuer-map/jobs] create failed", e);
    return NextResponse.json({ error: msg || "Failed to create job" }, { status: 500 });
  }
}
