"use client";

import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import type { SubstackSearchResult } from "@/lib/substack/types";

export function SubstackResultCard({ item, ticker }: { item: SubstackSearchResult; ticker: string }) {
  const post = item.post;
  const pubName = item.publication?.name ?? post.publicationName ?? "Substack";
  const when = post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : "—";

  return (
    <article className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--muted2)" }}>
        <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
          {pubName}
        </span>
        <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
          {item.discoverySource === "db" ? "indexed" : item.discoverySource === "serpapi_live" ? "live discovery" : "both"}
        </span>
        <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
          conf {Math.round(post.confidenceScore * 100)}%
        </span>
        <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
          {when}
        </span>
      </div>

      <div className="mt-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
        {post.title}
      </div>
      {post.contentSnippet ? (
        <div className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          {post.contentSnippet}
        </div>
      ) : null}

      {post.matchedTerms.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {post.matchedTerms.slice(0, 10).map((t) => (
            <span key={t} className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
              {t}
            </span>
          ))}
        </div>
      ) : null}

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
        <SaveFilingLinkButton ticker={ticker} url={post.url} mode="saved-documents" />
      </div>
    </article>
  );
}

