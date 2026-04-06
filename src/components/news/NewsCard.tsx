"use client";

import type { NormalizedNewsArticle } from "@/lib/news/types";

export function NewsCard({ article }: { article: NormalizedNewsArticle }) {
  let host = article.sourceDomain?.trim() || "";
  if (!host) {
    try {
      host = new URL(article.url).hostname;
    } catch {
      host = article.url;
    }
  }

  const when = article.publishedAt
    ? new Date(article.publishedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      {article.imageUrl ? (
        <div className="sm:w-40 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- external agency thumbnails */}
          <img
            src={article.imageUrl}
            alt=""
            className="h-28 w-full rounded object-cover sm:h-full sm:min-h-[7rem]"
            loading="lazy"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {article.providers.map((p) => (
            <span
              key={p}
              className="rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ borderColor: "var(--border2)", color: "var(--accent)" }}
            >
              {p.replace(/_/g, " ")}
            </span>
          ))}
        </div>
        <h3 className="mt-2 text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
          {article.title}
        </h3>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
          <span>{article.sourceName}</span>
          <span>{when}</span>
          <span className="font-mono">{host}</span>
        </div>
        {article.summary ? (
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            {article.summary}
          </p>
        ) : null}
        {article.providers.includes("newsapi") && article.matchedQuery ? (
          <p className="mt-1 font-mono text-[10px] leading-snug" style={{ color: "var(--muted)" }} title="NewsAPI everything q=">
            q: {article.matchedQuery}
          </p>
        ) : null}
        {article.tickers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {article.tickers.map((t) => (
              <span key={t} className="rounded bg-[var(--sb)] px-2 py-0.5 font-mono text-[10px]" style={{ color: "var(--accent)" }}>
                {t}
              </span>
            ))}
          </div>
        )}
        {article.sentimentLabel != null && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--muted2)" }}>
            Sentiment: {article.sentimentLabel}
            {article.sentimentScore != null ? ` (${article.sentimentScore.toFixed(2)})` : null}
          </p>
        )}
        <div className="mt-3">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-md border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
          >
            Open article
          </a>
        </div>
      </div>
    </article>
  );
}
