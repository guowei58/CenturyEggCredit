import { NextResponse } from "next/server";

import type { AiProvider } from "@/lib/ai-provider";
import { normalizeAiProvider } from "@/lib/ai-provider";
import { getModelCatalog } from "@/lib/ai-model-catalog";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";

export const dynamic = "force-dynamic";

/**
 * GET — merged model presets (curated static list + provider API discovery).
 * Refreshes from provider when disk cache is older than AI_MODEL_CATALOG_TTL_MS (default 24h).
 * Query: ?provider=openai | ?refresh=1
 */
export async function GET(request: Request) {
  const auth = await getAuthenticatedLlmContext();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const providerRaw = url.searchParams.get("provider");
  const provider = providerRaw ? normalizeAiProvider(providerRaw) : null;
  if (providerRaw && !provider) {
    return NextResponse.json({ ok: false, error: "Invalid provider" }, { status: 400 });
  }
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const catalog = await getModelCatalog(auth.ctx.bundle, {
    forceRefresh,
    provider: provider ?? undefined,
  });

  const slimProviders = Object.fromEntries(
    Object.entries(catalog.providers).map(([p, row]) => [
      p,
      {
        presets: row.presets,
        fetchedAt: row.fetchedAt,
        stale: row.stale,
        source: row.source,
        error: row.error,
      },
    ])
  ) as Record<AiProvider, (typeof catalog.providers)[AiProvider]>;

  return NextResponse.json({
    ok: true,
    cacheTtlMs: catalog.cacheTtlMs,
    providers: slimProviders,
  });
}
