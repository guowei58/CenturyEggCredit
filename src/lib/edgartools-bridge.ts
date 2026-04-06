/**
 * Python EdgarTools bridge (FastAPI). Server-side only — never NEXT_PUBLIC_.
 * Default in development: http://127.0.0.1:8765 when EDGAR_TOOLS_BRIDGE_URL is unset.
 */
export function edgarBridgeBaseUrl(): string | null {
  const fromEnv = process.env.EDGAR_TOOLS_BRIDGE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8765";
  return null;
}

export async function fetchFromEdgarBridge(pathWithQuery: string): Promise<Response> {
  const base = edgarBridgeBaseUrl();
  if (!base) {
    return new Response(
      JSON.stringify({
        error:
          "EdgarTools bridge URL is not configured. Set EDGAR_TOOLS_BRIDGE_URL (e.g. http://127.0.0.1:8765) and run the Python service in edgar-bridge/.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  const url = `${base}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  return fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    next: { revalidate: 0 },
  });
}
