import type { DailyNewsBatchPayload, DailyNewsItem } from "./types";
import { watchlistNewsDisplayLabel } from "./display-label";

export type AggregateNewsRow = {
  workspaceKey: string;
  displayLabel: string;
  publishedAt: string;
  source: string;
  headline: string;
  url: string;
  category: "SEC" | "Company" | "Industry";
};

function pushItems(
  rows: AggregateNewsRow[],
  workspaceKey: string,
  displayLabel: string,
  items: DailyNewsItem[],
  category: AggregateNewsRow["category"]
): void {
  for (const it of items) {
    rows.push({
      workspaceKey,
      displayLabel,
      publishedAt: it.publishedAt,
      source: it.source,
      headline: it.headline,
      url: it.url,
      category,
    });
  }
}

/** Flatten all ticker news blocks into one list, newest first. */
export function buildAggregateNewsRows(payload: DailyNewsBatchPayload): AggregateNewsRow[] {
  const rows: AggregateNewsRow[] = [];
  for (const tk of payload.tickers) {
    const block = payload.summaryByTicker[tk];
    if (!block) continue;
    const displayLabel = watchlistNewsDisplayLabel(tk, block.companyName);
    pushItems(rows, tk, displayLabel, block.secFilings, "SEC");
    pushItems(rows, tk, displayLabel, block.companyNews, "Company");
    pushItems(rows, tk, displayLabel, block.industryNews, "Industry");
  }
  return rows.sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.displayLabel.localeCompare(b.displayLabel) ||
      a.headline.localeCompare(b.headline)
  );
}

export function formatAggregateNewsDate(publishedAt: string): string {
  const raw = publishedAt.trim();
  if (!raw) return "—";
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
}

export function formatAggregateNewsCategory(category: AggregateNewsRow["category"]): string {
  if (category === "SEC") return "SEC filing";
  if (category === "Company") return "Company release";
  return "Industry news";
}
