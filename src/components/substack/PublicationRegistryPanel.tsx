"use client";

import { useEffect, useState } from "react";
import type { SubstackPublication } from "@/lib/substack/types";

export function PublicationRegistryPanel() {
  const [items, setItems] = useState<SubstackPublication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/substack/publications?limit=50")
      .then(async (r) => ({ ok: r.ok, json: (await r.json()) as any }))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error || "Failed to load publications");
        if (!cancelled) setItems((json.publications ?? []) as SubstackPublication[]);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load publications");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border2)", background: "var(--sb)" }}>
      <div className="font-semibold" style={{ color: "var(--text)" }}>
        Publication registry (top 50)
      </div>
      {loading ? (
        <p className="mt-2" style={{ color: "var(--muted2)" }}>
          Loading…
        </p>
      ) : error ? (
        <p className="mt-2" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" style={{ color: "var(--muted2)" }}>
          {items.map((p) => (
            <li key={p.id} className="break-words">
              {p.name ?? p.subdomain ?? p.baseUrl} — conf {Math.round(p.confidenceScore * 100)}% —{" "}
              <a href={p.baseUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
                open
              </a>
              {p.feedUrl ? (
                <>
                  {" "}
                  —{" "}
                  <a href={p.feedUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
                    feed
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

