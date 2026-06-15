/**
 * Client helpers for per-ticker saved files (server-backed).
 */

export type { SavedDataKey } from "./saved-ticker-data";
import type { SavedDataKey } from "./saved-ticker-data";

/** No-op compatibility POST so clients can "warm" the session before first save. */
export async function initTickerSaveFolder(ticker: string): Promise<void> {
  const t = ticker?.trim();
  if (!t) return;
  try {
    await fetch(`/api/saved-data/${encodeURIComponent(t)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ init: true }),
    });
  } catch {
    // ignore 鈥?folder will be created on first save
  }
}

export async function fetchSavedFromServer(ticker: string, key: SavedDataKey): Promise<string | null> {
  const t = ticker?.trim();
  if (!t) return null;
  try {
    const res = await fetch(`/api/saved-data/${encodeURIComponent(t)}?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string };
    return typeof data.content === "string" ? data.content : null;
  } catch {
    return null;
  }
}

export async function saveToServer(ticker: string, key: SavedDataKey, content: string): Promise<boolean> {
  const t = ticker?.trim();
  if (!t) return false;
  try {
    const res = await fetch(`/api/saved-data/${encodeURIComponent(t)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Per-tab saved text from the server only (no browser storage). */
export async function fetchSavedTabContent(ticker: string, key: SavedDataKey): Promise<string> {
  const t = ticker?.trim();
  if (!t) return "";
  return (await fetchSavedFromServer(t, key)) ?? "";
}
