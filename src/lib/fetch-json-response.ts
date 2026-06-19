/** Read a fetch Response body as JSON with clearer errors when the body is empty or invalid. */
export async function readFetchJson<T = Record<string, unknown>>(
  res: Response,
  context?: string
): Promise<T> {
  const raw = await res.text();
  const label = context?.trim() || "API request";

  if (!raw.trim()) {
    if (res.status === 504 || res.status === 408) {
      throw new Error(`${label}: server timed out (${res.status})`);
    }
    if (res.status >= 500) {
      throw new Error(`${label}: server error with empty response (${res.status})`);
    }
    throw new Error(`${label}: empty response (${res.status})`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    const snippet = raw.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`${label}: ${msg}${snippet ? ` — ${snippet}` : ""}`);
  }
}
