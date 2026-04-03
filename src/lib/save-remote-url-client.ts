/**
 * Client-side POST to save a remote URL into the ticker folder (Saved Documents / filings allowlist).
 */

export type SaveRemoteUrlMode = "filings" | "saved-documents";

export type SaveRemoteUrlResult = { ok: true } | { ok: false; error: string };

export async function saveRemoteUrlForTicker(
  ticker: string,
  url: string,
  mode: SaveRemoteUrlMode
): Promise<SaveRemoteUrlResult> {
  const t = ticker.trim();
  const u = url.trim();
  if (!t || !u) return { ok: false, error: "Missing ticker or URL" };

  const path =
    mode === "filings"
      ? `/api/save-filing-link/${encodeURIComponent(t)}`
      : `/api/saved-documents/${encodeURIComponent(t)}`;

  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: u }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok) {
      return { ok: false, error: body?.error ?? `Save failed (HTTP ${res.status}).` };
    }
    if (body?.ok !== true) {
      return { ok: false, error: body?.error ?? "Save failed." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
