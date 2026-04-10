/**
 * Client-only: POST historical-model API and trigger a ZIP download in the browser.
 */
export async function downloadSecXbrlHistoricalModelZip(ticker: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return { ok: false, error: "Ticker required" };
  const res = await fetch(`/api/sec/xbrl/historical-model/${encodeURIComponent(tk)}`, { method: "POST" });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? `Request failed (${res.status})` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tk}_SEC-XBRL-historical-model.zip`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { ok: true };
}
