/**
 * Saved-tab filenames and keys. Tab text lives in Postgres (`UserTickerDocument`), not on project disk.
 */

/** Allowed save keys → filename (no extension in key) */
export const SAVED_DATA_FILES: Record<string, string> = {
  "business-model": "business-model.txt",
  "company-history": "company-history.txt",
  customers: "customers.txt",
  suppliers: "suppliers.txt",
  "subsidiary-list": "subsidiary-list.txt",
  "credit-timeline": "credit-timeline.txt",
  "management-board": "management-board.txt",
  "out-of-the-box-ideas": "out-of-the-box-ideas.txt",
  "research-roadmap": "research-roadmap.txt",
  "ai-credit-memo-latest": "ai-credit-memo-latest.md",
  "ai-credit-memo-latest-meta": "ai-credit-memo-latest-meta.json",
  "credit-agreements-indentures": "credit-agreements-indentures.txt",
  "credit-agreements-indentures-credit-agreement": "credit-agreements-indentures-credit-agreement.txt",
  "credit-agreements-indentures-first-lien-indenture": "credit-agreements-indentures-first-lien-indenture.txt",
  "credit-agreements-indentures-second-lien-indenture": "credit-agreements-indentures-second-lien-indenture.txt",
  "credit-agreements-indentures-unsecured": "credit-agreements-indentures-unsecured.txt",
  "credit-agreements-indentures-other": "credit-agreements-indentures-other.txt",
  "startup-risks": "startup-risks.txt",
  "risk-from-10k": "risk-from-10k.txt",
  "overview": "overview.txt",
  "porters-five-forces": "porters-five-forces.txt",
  competitors: "competitors.txt",
  "capital-structure": "capital-structure.txt",
  "news-events": "news-events.txt",
  "earnings-releases": "earnings-releases.txt",
  presentations: "presentations.txt",
  "trade-recommendation": "trade-recommendation.txt",
  "notes-thoughts": "notes-thoughts.txt",
  "org-chart-prompt": "org-chart-prompt.txt",
  "historical-financials-prompt": "historical-financials-prompt.txt",
  "ai-credit-deck": "ai-credit-deck.txt",
  "employee-contacts": "employee-contacts.html",
  "industry-contacts": "industry-contacts.html",
  "dear-diary": "dear-diary.txt",
  "covenants-synthesis": "covenants-synthesis.md",
  "covenants-synthesis-meta": "covenants-synthesis-meta.json",
  // Latest memo artifacts written automatically by the AI Credit Memo generator.
  "ai-credit-memo-latest-source-pack": "ai-credit-memo-latest-source-pack.txt",
  "ai-credit-memo-buffett": "ai-credit-memo-buffett.md",
  "ai-credit-memo-buffett-meta": "ai-credit-memo-buffett-meta.json",
  "ai-credit-memo-buffett-source-pack": "ai-credit-memo-buffett-source-pack.txt",
  "ai-credit-memo-munger": "ai-credit-memo-munger.md",
  "ai-credit-memo-munger-meta": "ai-credit-memo-munger-meta.json",
  "ai-credit-memo-munger-source-pack": "ai-credit-memo-munger-source-pack.txt",
  "ai-credit-memo-shakespeare": "ai-credit-memo-shakespeare.md",
  "ai-credit-memo-shakespeare-meta": "ai-credit-memo-shakespeare-meta.json",
  "ai-credit-memo-shakespeare-source-pack": "ai-credit-memo-shakespeare-source-pack.txt",
  "ai-credit-memo-lynch": "ai-credit-memo-lynch.md",
  "ai-credit-memo-lynch-meta": "ai-credit-memo-lynch-meta.json",
  "ai-credit-memo-lynch-source-pack": "ai-credit-memo-lynch-source-pack.txt",
  "ai-credit-memo-soros": "ai-credit-memo-soros.md",
  "ai-credit-memo-soros-meta": "ai-credit-memo-soros-meta.json",
  "ai-credit-memo-soros-source-pack": "ai-credit-memo-soros-source-pack.txt",
  "ai-credit-memo-ackman": "ai-credit-memo-ackman.md",
  "ai-credit-memo-ackman-meta": "ai-credit-memo-ackman-meta.json",
  "ai-credit-memo-ackman-source-pack": "ai-credit-memo-ackman-source-pack.txt",
};

/**
 * Filenames at ticker root for AI Chat ingestion order. Core research tabs first; bulky
 * `credit-agreements-indentures*` saves are handled separately and appended last so they
 * do not starve smaller files like credit-timeline.txt (lexicographic order put "credit-agreements…" before "credit-timeline").
 */
export const SAVED_TAB_FILENAME_AI_PRIORITY: readonly string[] = [
  "overview.txt",
  "management-board.txt",
  "out-of-the-box-ideas.txt",
  "research-roadmap.txt",
  "employee-contacts.html",
  "industry-contacts.html",
  "dear-diary.txt",
  "ai-credit-memo-latest.md",
  "ai-credit-memo-latest-meta.json",
  "ai-credit-memo-buffett.md",
  "ai-credit-memo-buffett-meta.json",
  "ai-credit-memo-munger.md",
  "ai-credit-memo-munger-meta.json",
  "ai-credit-memo-shakespeare.md",
  "ai-credit-memo-shakespeare-meta.json",
  "ai-credit-memo-lynch.md",
  "ai-credit-memo-lynch-meta.json",
  "ai-credit-memo-soros.md",
  "ai-credit-memo-soros-meta.json",
  "ai-credit-memo-ackman.md",
  "ai-credit-memo-ackman-meta.json",
  "business-model.txt",
  "company-history.txt",
  "credit-timeline.txt",
  "capital-structure.txt",
  "subsidiary-list.txt",
  "porters-five-forces.txt",
  "competitors.txt",
  "startup-risks.txt",
  "risk-from-10k.txt",
  "news-events.txt",
  "earnings-releases.txt",
  "presentations.txt",
  "trade-recommendation.txt",
  "notes-thoughts.txt",
  "ai-credit-deck.txt",
  "org-chart-prompt.txt",
  "historical-financials-prompt.txt",
  "covenants-synthesis.md",
  "covenants-synthesis-meta.json",
  "ai-credit-memo-latest-source-pack.txt",
];

export function isHeavyCovenantRootFile(basename: string): boolean {
  return basename.toLowerCase().startsWith("credit-agreements-indentures");
}

export type SavedDataKey = keyof typeof SAVED_DATA_FILES;

export function sanitizeTicker(ticker: string): string | null {
  const t = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t.length > 0 && t.length <= 12 ? t : null;
}

