"use client";

import type { SubstackSearchResult } from "@/lib/substack/types";
import { SubstackResultCard } from "./SubstackResultCard";

export function SubstackSearchResults({ items, ticker }: { items: SubstackSearchResult[]; ticker: string }) {
  if (items.length === 0) {
    return (
      <p className="text-sm py-3" style={{ color: "var(--muted2)" }}>
        No results yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.post.id}>
          <SubstackResultCard item={it} ticker={ticker} />
        </li>
      ))}
    </ul>
  );
}

