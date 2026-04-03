import { NextResponse } from "next/server";

import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { WEB_SEARCH_TOOL } from "@/lib/anthropic";
import { getCompanyProfile } from "@/lib/sec-edgar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function tryExtractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)>"']+/i);
  if (!m) return null;
  return m[0];
}

function isPlausibleIrUrl(u: string): boolean {
  const s = u.toLowerCase();
  if (!/^https?:\/\//.test(s)) return false;
  if (/\.(pdf|zip|pptx?|xlsx?)($|[?#])/.test(s)) return false;
  return /(investor|investors|investor-relations|investorrelations|shareholders|\bir\b)/.test(s);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();

  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  // Per user request: always use Claude web search (this endpoint is called once and cached client-side).
  if (!isProviderConfigured("claude")) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
  }

  // Prefer company name to improve search quality, but ticker alone is acceptable.
  const profile = await getCompanyProfile(ticker);
  const companyName = profile?.name?.trim() || ticker;

  // Use Claude web_search once, then return a small ranked list (client can pick + cache).
  const system = `You are a buy-side analyst assistant. Find the company's official Investor Relations (IR) landing page URL. Output ONLY JSON.`;
  const user = `Find the OFFICIAL Investor Relations (IR) landing page for:
Company: ${companyName}
Ticker: ${ticker}

Requirements:
- Use web_search to find the best official IR landing page.
- Prefer the company's own domain or official IR host (avoid Wikipedia, brokers, random blogs).
- Return up to 5 candidates, best first.
- Output ONLY JSON with shape:
  {"candidates":[{"url":"https://...","confidence":"high|medium|low","notes":"why this is likely the IR landing page"}]}
`;

  const result = await llmCompleteSingle("claude", system, user, {
    maxTokens: 900,
    claudeTools: [WEB_SEARCH_TOOL],
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Search failed" }, { status: result.status ?? 502 });
  }

  const raw = result.text.trim();
  const parsed = safeJsonParse<{ candidates?: Array<{ url?: unknown; confidence?: unknown; notes?: unknown }> }>(raw);
  const candidates =
    parsed?.candidates
      ?.map((c) => ({
        url: typeof c.url === "string" ? c.url.trim() : "",
        confidence: c.confidence === "high" || c.confidence === "medium" || c.confidence === "low" ? c.confidence : "medium",
        notes: typeof c.notes === "string" ? c.notes : "",
      }))
      .filter((c) => Boolean(c.url) && /^https?:\/\//i.test(c.url))
      .slice(0, 5) ?? [];

  if (candidates.length === 0) {
    const first = tryExtractFirstUrl(raw);
    if (first && /^https?:\/\//i.test(first)) {
      candidates.push({ url: first, confidence: "low", notes: "Extracted URL from non-JSON response." });
    }
  }

  const best = candidates.find((c) => isPlausibleIrUrl(c.url)) ?? candidates[0] ?? null;
  if (!best) {
    return NextResponse.json({ error: "Could not extract IR URL candidates from search result", raw: raw.slice(0, 700) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    ticker,
    companyName,
    url: best.url,
    confidence: best.confidence,
    notes: best.notes,
    candidates,
    provider: "claude",
  });
}

