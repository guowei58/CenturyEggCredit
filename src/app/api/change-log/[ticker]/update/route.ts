import { NextResponse } from "next/server";
import { normalizeAiProvider, type AiProvider } from "@/lib/ai-provider";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { computeChangeLogUpdatePeriod } from "@/lib/change-log/period";
import { synthesizeChangeLogEntries } from "@/lib/change-log/generate";
import { gatherChangeLogSources } from "@/lib/change-log/sources";
import {
  collectPriorDedupeKeys,
  readChangeLogStore,
  writeChangeLogStore,
} from "@/lib/change-log/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PostBody = {
  provider?: unknown;
};

/** POST — gather sources and generate a draft Change Log update */
export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId, bundle, llmTemperature } = llmAuth.ctx;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    /* empty body ok */
  }

  const requestedProvider = normalizeAiProvider(body.provider) as AiProvider | null;
  if (requestedProvider && !isProviderConfigured(requestedProvider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  const store = await readChangeLogStore(sym, userId);
  const now = new Date();
  const startedAt = now.toISOString();
  const period = computeChangeLogUpdatePeriod(now, store.lastChangeLogUpdatedAt);

  store.currentUpdateStartedAt = startedAt;
  store.currentUpdateCompletedAt = null;
  store.draft = {
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    periodLabel: period.periodLabel,
    startedAt,
    completedAt: null,
    status: "running",
    entries: [],
  };
  await writeChangeLogStore(sym, userId, store);

  const excludeDedupeKeys = collectPriorDedupeKeys(store);

  try {
    const gathered = await gatherChangeLogSources({
      ticker: sym,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      excludeDedupeKeys,
      userId,
    });

    const synthesized = await synthesizeChangeLogEntries({
      ticker: sym,
      companyName: gathered.companyName,
      periodLabel: period.periodLabel,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      candidates: gathered.candidates,
      excludeDedupeKeys,
      provider: requestedProvider,
      apiKeys: bundle,
      temperature: llmTemperature,
    });

    const completedAt = new Date().toISOString();
    store.draft = {
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      periodLabel: period.periodLabel,
      startedAt,
      completedAt,
      status: "ready",
      entries: synthesized.entries,
      error: synthesized.llmError,
    };
    store.currentUpdateCompletedAt = completedAt;
    await writeChangeLogStore(sym, userId, store);

    return NextResponse.json({
      ok: true,
      store,
      meta: {
        candidateCount: gathered.candidates.length,
        entryCount: synthesized.entries.length,
        usedLlm: synthesized.usedLlm,
        fetchErrors: gathered.fetchErrors,
        llmError: synthesized.llmError,
        sec: {
          cik: gathered.sec.cik,
          totalFilingsFetched: gathered.sec.totalFilingsFetched,
          inPeriodCount: gathered.sec.inPeriodCount,
          materialInPeriodCount: gathered.sec.materialInPeriodCount,
          secCandidates: gathered.sec.candidates.length,
          error: gathered.sec.error,
        },
        competitors: {
          tickers: gathered.competitors.tickers.map((c) => c.ticker),
          sources: gathered.competitors.tickers.map((c) => c.source),
          candidateCount: gathered.competitors.candidateCount,
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    const completedAt = new Date().toISOString();
    store.draft = {
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      periodLabel: period.periodLabel,
      startedAt,
      completedAt,
      status: "failed",
      error: msg,
      entries: [],
    };
    store.currentUpdateCompletedAt = completedAt;
    await writeChangeLogStore(sym, userId, store);
    return NextResponse.json({ error: msg, store }, { status: 500 });
  }
}
