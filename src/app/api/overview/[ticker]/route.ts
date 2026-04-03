import { NextResponse } from "next/server";
import { resolveProvider } from "@/lib/ai-provider";
import { get10KOverviewRaw } from "@/lib/sec-10k";
import { isProviderConfigured } from "@/lib/llm-router";
import { summarizeBusinessOverview, summarizeBusinessLines } from "@/lib/overview-claude";
import { checkOllamaHealth } from "@/lib/ollama";
import { resolveOverviewLlmModels } from "@/lib/ai-model-from-request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type OverviewSegment = {
  segmentName: string;
  description: string;
  revenue: number | null;
  pctOfTotal: number | null;
};

export type OverviewResponse = {
  companyName: string;
  sourceFiling: { filingDate: string; form: string; docUrl: string };
  businessOverviewSummary: string;
  businessLines: OverviewSegment[];
  totalRevenue: number | null;
  segmentRevenueUnclear: boolean;
  noSegmentRevenueMessage: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const safeTicker = typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
  if (!safeTicker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const provider = resolveProvider(searchParams.get("provider"));
  const overviewModels = resolveOverviewLlmModels(provider, searchParams.get("model"));
  if (!isProviderConfigured(provider)) {
    const msg =
      provider === "openai"
        ? "OPENAI_API_KEY is not set. Add it to .env.local for OpenAI overview summaries."
        : provider === "gemini"
          ? "GEMINI_API_KEY is not set. Add it to .env.local for Gemini overview summaries."
          : "ANTHROPIC_API_KEY is not set. Add it to .env.local for Claude overview summaries.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  if (provider === "ollama") {
    const h = await checkOllamaHealth();
    if (h.status === "disconnected") {
      return NextResponse.json({ error: "Ollama not reachable. Run `ollama serve`." }, { status: 503 });
    }
    if (h.status === "model_missing") {
      return NextResponse.json(
        { error: `Ollama model missing. Run: ollama pull ${h.model}` },
        { status: 503 }
      );
    }
    if (h.status === "error") {
      return NextResponse.json({ error: h.detail?.slice(0, 200) ?? "Ollama check failed." }, { status: 503 });
    }
  }

  try {
    const raw = await get10KOverviewRaw(safeTicker);
    if (!raw) {
      return NextResponse.json(
        { error: "No 10-K available for this company." },
        { status: 404 }
      );
    }

    const [businessOverviewSummary, segmentSummaries] = await Promise.all([
      summarizeBusinessOverview(raw.item1Text, provider, overviewModels),
      summarizeBusinessLines(
        raw.segmentNames,
        raw.item1Text,
        raw.segmentRevenues,
        raw.totalRevenue,
        provider,
        overviewModels
      ),
    ]);

    let totalRevenue = raw.totalRevenue;
    const segmentRevenuesByName = new Map(raw.segmentRevenues.map((s) => [s.segmentName, s.revenue]));

    const businessLines: OverviewSegment[] = segmentSummaries.map((s) => ({
      segmentName: s.segmentName,
      description: s.description,
      revenue: s.revenue ?? segmentRevenuesByName.get(s.segmentName) ?? null,
      pctOfTotal: s.pctOfTotal ?? null,
    }));

    if (totalRevenue == null && businessLines.some((b) => b.revenue != null)) {
      totalRevenue = businessLines.reduce((sum, b) => sum + (b.revenue ?? 0), 0);
    }

    if (totalRevenue != null && totalRevenue > 0) {
      for (const line of businessLines) {
        if (line.revenue != null && line.pctOfTotal == null) {
          line.pctOfTotal = Math.round((line.revenue / totalRevenue) * 1000) / 10;
        }
      }
    }

    let noSegmentRevenueMessage: string | null = null;
    if (raw.segmentRevenueUnclear || (raw.segmentNames.length > 1 && raw.segmentRevenues.length === 0)) {
      noSegmentRevenueMessage =
        "Business lines or segment revenue could not be fully determined from the latest 10-K.";
    }
    if (raw.segmentNames.length <= 1 && raw.segmentNames[0]?.toLowerCase().includes("core business")) {
      noSegmentRevenueMessage = "The company does not report separate business segments; one main business line is described above.";
    }

    const payload: OverviewResponse = {
      companyName: raw.companyName,
      sourceFiling: {
        filingDate: raw.source.filingDate,
        form: raw.source.form,
        docUrl: raw.source.docUrl,
      },
      businessOverviewSummary,
      businessLines,
      totalRevenue,
      segmentRevenueUnclear: raw.segmentRevenueUnclear,
      noSegmentRevenueMessage,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (e) {
    console.error("overview API error:", e);
    const message = e instanceof Error ? e.message : "Failed to build overview.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
