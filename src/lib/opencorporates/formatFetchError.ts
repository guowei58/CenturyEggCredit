/** Turn Node/browser fetch failures into actionable messages for logs and API responses. */
export function formatOutboundFetchError(err: unknown, context: string): Error {
  const base = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause != null
      ? err.cause instanceof Error
        ? err.cause.message
        : String(err.cause)
      : "";

  const detail = [base, cause].filter(Boolean).join(" — ");

  if (/certificate|SSL|TLS|UNABLE_TO_VERIFY/i.test(detail)) {
    return new Error(
      `${context}: TLS/certificate problem talking to OpenCorporates (${detail}). Check proxy/VPN or OS trust store.`
    );
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
    return new Error(
      `${context}: DNS lookup failed (${detail}). Check internet connection and DNS.`
    );
  }
  if (/ECONNREFUSED|ECONNRESET/i.test(detail)) {
    return new Error(
      `${context}: Connection refused or reset (${detail}). Firewall or remote server may be blocking outbound HTTPS.`
    );
  }
  if (/fetch failed/i.test(base) || base === "Failed to fetch") {
    return new Error(
      `${context}: Network request failed (${detail || "no route to host"}). Confirm outbound access to api.opencorporates.com and opencorporates.com, or try again later.`
    );
  }

  return new Error(`${context}: ${detail || base}`);
}
