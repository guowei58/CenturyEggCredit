import { formatOutboundFetchError } from "@/lib/opencorporates/formatFetchError";

/** Target ≤5 requests/sec → minimum 200ms between calls. */
const MIN_INTERVAL_MS = 220;

let lastInvokeAt = Date.now() - MIN_INTERVAL_MS;

export async function ocThrottle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastInvokeAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastInvokeAt = Date.now();
}

export async function fetchWithBackoff(
  url: string,
  opts: RequestInit & { retries?: number } = {}
): Promise<Response> {
  const maxRetries = opts.retries ?? 4;
  let attempt = 0;
  let delay = 800;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(url, {
        ...opts,
        headers: {
          Accept: "application/json",
          "User-Agent": "CenturyEggCredit/1.0 (opencorporates-integration)",
          ...(opts.headers ?? {}),
        },
      });
    } catch (e) {
      throw formatOutboundFetchError(e, "OpenCorporates HTTP client");
    }
    if (res.status === 429 || res.status === 503) {
      if (attempt > maxRetries) return res;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
      continue;
    }
    return res;
  }
}
