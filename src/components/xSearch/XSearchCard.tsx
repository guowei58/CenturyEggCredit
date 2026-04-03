"use client";

import type { NormalizedXPost } from "@/lib/xSearch/types";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";

export function XSearchCard({ post, ticker }: { post: NormalizedXPost; ticker: string }) {
  const when = post.createdAt
    ? new Date(post.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
  const safeTicker = ticker.trim();

  return (
    <article className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
        <span className="font-semibold" style={{ color: "var(--text)" }}>
          {post.authorName ?? "Unknown"}
        </span>
        {post.authorUsername ? <span className="font-mono">@{post.authorUsername}</span> : null}
        <span>{when}</span>
        <span className="rounded border px-2 py-0.5 text-[10px]" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          {post.sourceProvider.replace(/_/g, " ")}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--text)" }}>
        {post.text}
      </p>

      {post.matchSignals.length > 0 && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--muted2)" }}>
          Signals: {post.matchSignals.join(", ")} · Confidence: {post.confidenceScore.toFixed(2)} · Relevance:{" "}
          {post.relevanceScore.toFixed(1)}
        </p>
      )}

      {post.metrics && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
          {post.metrics.likeCount != null ? <span>Likes: {post.metrics.likeCount}</span> : null}
          {post.metrics.repostCount != null ? <span>Reposts: {post.metrics.repostCount}</span> : null}
          {post.metrics.replyCount != null ? <span>Replies: {post.metrics.replyCount}</span> : null}
          {post.metrics.quoteCount != null ? <span>Quotes: {post.metrics.quoteCount}</span> : null}
          {post.metrics.impressionCount != null ? <span>Impr: {post.metrics.impressionCount}</span> : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md border px-3 py-2 text-xs font-semibold"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
        >
          Open post
        </a>
        <SaveFilingLinkButton ticker={safeTicker} url={post.url} mode="saved-documents" />
      </div>
    </article>
  );
}

