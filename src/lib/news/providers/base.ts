import type { NewsQueryParams, ProviderFetchResult, ProviderRuntimeContext } from "../types";

export function okResult(
  providerId: string,
  articles: ProviderFetchResult["articles"],
  rawCount?: number
): ProviderFetchResult {
  return { providerId, success: true, articles, rawCount };
}

export function errResult(providerId: string, message: string): ProviderFetchResult {
  return { providerId, success: false, articles: [], error: message };
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, next: { revalidate: 0 } });
  } finally {
    clearTimeout(tid);
  }
}

export function perRequestLimit(params: NewsQueryParams, cfgMax: number, hardCap = 100): number {
  const fromReq = params.limit != null ? Math.floor(params.limit) : cfgMax;
  return Math.min(hardCap, Math.max(1, Math.min(fromReq, cfgMax)));
}

export function buildRuntimeContext(
  config: import("../types").ProviderConfig,
  apiKey: string | undefined
): ProviderRuntimeContext {
  return { config, apiKey };
}
