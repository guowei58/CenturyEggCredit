/**
 * Client helpers for per-ticker saved files (server-backed).
 */

export type SavedDataKey =
  | "business-model"
  | "company-history"
  | "capital-allocation"
  | "customers"
  | "suppliers"
  | "subsidiary-list"
  | "credit-timeline"
  | "management-board"
  | "out-of-the-box-ideas"
  | "research-roadmap"
  | "ai-credit-memo-latest"
  | "ai-credit-memo-latest-meta"
  | "credit-agreements-indentures"
  | "credit-agreements-indentures-credit-agreement"
  | "credit-agreements-indentures-first-lien-indenture"
  | "credit-agreements-indentures-second-lien-indenture"
  | "credit-agreements-indentures-unsecured"
  | "credit-agreements-indentures-convertible"
  | "credit-agreements-indentures-preferred"
  | "credit-agreements-indentures-other"
  | "startup-risks"
  | "risk-from-10k"
  | "overview"
  | "recent-events"
  | "how-stuff-works"
  | "porters-five-forces"
  | "industry-history-drivers"
  | "competitors"
  | "capital-structure"
  | "news-events"
  | "industry-publications"
  | "industry-value-chain"
  | "earnings-releases"
  | "presentations"
  | "trade-recommendation"
  | "notes-thoughts"
  | "org-chart-prompt"
  | "historical-financials-prompt"
  | "xbrl-consolidated-financials-ai"
  | "ai-credit-deck"
  | "employee-contacts"
  | "industry-contacts"
  | "dear-diary"
  | "ai-credit-memo-buffett"
  | "ai-credit-memo-buffett-meta"
  | "ai-credit-memo-buffett-source-pack"
  | "ai-credit-memo-munger"
  | "ai-credit-memo-munger-meta"
  | "ai-credit-memo-munger-source-pack"
  | "ai-credit-memo-shakespeare"
  | "ai-credit-memo-shakespeare-meta"
  | "ai-credit-memo-shakespeare-source-pack"
  | "ai-credit-memo-lynch"
  | "ai-credit-memo-lynch-meta"
  | "ai-credit-memo-lynch-source-pack"
  | "ai-credit-memo-soros"
  | "ai-credit-memo-soros-meta"
  | "ai-credit-memo-soros-source-pack"
  | "ai-credit-memo-ackman"
  | "ai-credit-memo-ackman-meta"
  | "ai-credit-memo-ackman-source-pack"
  | "ai-credit-memo-kafka"
  | "ai-credit-memo-kafka-meta"
  | "ai-credit-memo-kafka-source-pack"
  | "ai-credit-memo-nietzsche"
  | "ai-credit-memo-nietzsche-meta"
  | "ai-credit-memo-nietzsche-source-pack"
  | "ai-credit-memo-latest"
  | "ai-credit-memo-latest-meta"
  | "ai-credit-memo-latest-source-pack"
  | "cs-recommendation-latest"
  | "cs-recommendation-latest-meta"
  | "cs-recommendation-latest-source-pack"
  | "entity-mapper-latest"
  | "entity-mapper-latest-meta"
  | "entity-mapper-v2-snapshot"
  | "entity-mapper-sec-debt-index"
  | "kpi-latest"
  | "kpi-latest-meta"
  | "kpi-latest-source-pack"
  | "forensic-accounting-latest"
  | "forensic-accounting-latest-meta"
  | "forensic-accounting-latest-source-pack"
  | "literary-references-latest"
  | "literary-references-latest-meta"
  | "literary-references-latest-source-pack"
  | "biblical-references-latest"
  | "biblical-references-latest-meta"
  | "biblical-references-latest-source-pack";

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
