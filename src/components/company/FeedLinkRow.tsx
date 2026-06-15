"use client";

import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";

export type FeedLinkRowProps = {
  title: string;
  url: string;
  ticker: string;
  source?: string | null;
  /** ISO date, RFC string, or display-ready date text. */
  publishedAt?: string | null;
  openLabel?: string;
};

function formatFeedDate(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleDateString(undefined, { dateStyle: "medium" });
  }
  return value.trim();
}

export function FeedLinkRow({
  title,
  url,
  ticker,
  source,
  publishedAt,
  openLabel = "Open",
}: FeedLinkRowProps) {
  const when = formatFeedDate(publishedAt);
  const sourceLabel = source?.trim() || "";

  return (
    <article className="flex items-center gap-2 py-2 sm:gap-3">
      <h3
        className="min-w-0 flex-1 truncate text-sm font-medium leading-snug"
        style={{ color: "var(--text)" }}
        title={title}
      >
        {title}
      </h3>
      {sourceLabel ? (
        <span
          className="max-w-[7rem] shrink-0 truncate text-[11px] sm:max-w-[9rem]"
          style={{ color: "var(--muted2)" }}
          title={sourceLabel}
        >
          {sourceLabel}
        </span>
      ) : null}
      <time
        className="shrink-0 whitespace-nowrap text-[11px]"
        style={{ color: "var(--muted)" }}
        dateTime={publishedAt ?? undefined}
      >
        {when}
      </time>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold"
        style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
      >
        {openLabel}
      </a>
      <SaveFilingLinkButton
        ticker={ticker}
        url={url}
        mode="saved-documents"
        className="ml-0 shrink-0 px-2.5 py-1 normal-case text-xs"
      />
    </article>
  );
}
