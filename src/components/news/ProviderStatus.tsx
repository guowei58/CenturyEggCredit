"use client";

import { PRODUCTION_NEWS_PROVIDER_IDS } from "@/lib/news/constants";
import type { NewsAggregationResponse } from "@/lib/news/types";

export function ProviderStatus({
  payload,
}: {
  payload: Pick<NewsAggregationResponse, "activeProviders" | "disabledProviders" | "providerStats"> | null;
}) {
  const allIds = PRODUCTION_NEWS_PROVIDER_IDS as readonly string[];

  if (!payload) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Run a search to see provider status.
      </p>
    );
  }

  return (
    <div
      className="rounded-lg border p-3 text-[11px] leading-relaxed"
      style={{ borderColor: "var(--border2)", background: "var(--sb)" }}
    >
      <div className="font-semibold" style={{ color: "var(--text)" }}>
        Providers
      </div>
      <ul className="mt-2 space-y-1" style={{ color: "var(--muted2)" }}>
        {allIds.map((id) => {
          const stat = payload.providerStats[id];
          const invoked = payload.activeProviders.includes(id);
          const disabled = payload.disabledProviders.includes(id);
          let line = `${id}: `;
          if (disabled && !invoked) {
            line += stat?.error ? `skipped — ${stat.error}` : "skipped";
          } else if (stat?.success) {
            line += `ok (${stat.count} articles)`;
          } else {
            line += stat?.error ? `failed — ${stat.error}` : "failed";
          }
          return <li key={id}>{line}</li>;
        })}
      </ul>
    </div>
  );
}
