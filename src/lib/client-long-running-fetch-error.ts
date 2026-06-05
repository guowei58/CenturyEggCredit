/** User-facing message when a long-running tab job loses its HTTP connection. */
export function formatLongRunningJobFetchError(err: unknown, jobLabel: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed")
  ) {
    return (
      `${jobLabel} did not finish in time or the connection dropped before the server responded. ` +
      `These runs often take several minutes (source packing, embeddings, and long LLM output). ` +
      `Retry once, try a faster model in User Settings (e.g. gpt-4o-mini), and confirm sources/ingest completed.`
    );
  }
  if (lower.includes("unexpected end of json") || lower.includes("json input")) {
    return (
      `${jobLabel}: the server stopped responding before returning a result (likely a timeout). ` +
      `Retry with a faster model or wait for a quieter database window.`
    );
  }
  return msg.trim() || `${jobLabel} failed`;
}
