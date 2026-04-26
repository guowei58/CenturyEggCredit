"use client";

import type { AiProvider } from "@/lib/ai-provider";
import {
  OREO_INGEST_NOTE,
  PROVIDER_LIMITS_INTRO,
  resolveModelLimits,
  type ResolvedModelLimits,
} from "@/lib/llm-model-limit-profiles";

function LimitBody({ r }: { r: ResolvedModelLimits }) {
  return (
    <div className="space-y-1.5 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
      <p className="font-medium" style={{ color: "var(--text)" }}>
        {r.displayTitle}
      </p>
      <dl className="space-y-1.5">
        <div>
          <dt className="font-medium" style={{ color: "var(--muted)" }}>
            Context window
          </dt>
          <dd>{r.contextWindow}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: "var(--muted)" }}>
            Max output
          </dt>
          <dd>{r.maxOutput}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: "var(--muted)" }}>
            Rate limits
          </dt>
          <dd>{r.rateLimits}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: "var(--muted)" }}>
            Files and uploads
          </dt>
          <dd>{r.filesAndUploads}</dd>
        </div>
      </dl>
      <p>
        <a
          href={r.documentationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium"
          style={{ color: "var(--accent)" }}
        >
          Provider documentation
        </a>
      </p>
      {r.footnotes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[9px]" style={{ color: "var(--muted)" }}>
          {r.footnotes.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Shows vendor-documented limits for the selected API model (updates when the model preset changes).
 * Use `multi` when the screen has one model picker per provider (e.g. SEC XBRL consolidation).
 */
export function ProviderPublicLimitsSidePanel({
  provider,
  resolvedModelId,
  multi,
  className = "",
}: {
  provider?: AiProvider;
  resolvedModelId?: string | null;
  multi?: Array<{ provider: AiProvider; resolvedModelId?: string | null }>;
  className?: string;
}) {
  const inner =
    multi && multi.length > 0 ? (
      <div className="space-y-3">
        {multi.map((m) => {
          const r = resolveModelLimits(m.provider, m.resolvedModelId ?? undefined);
          return (
            <section
              key={m.provider}
              className="border-t pt-3 first:border-t-0 first:pt-0"
              style={{ borderColor: "var(--border2)" }}
            >
              <LimitBody r={r} />
            </section>
          );
        })}
      </div>
    ) : provider ? (
      <LimitBody r={resolveModelLimits(provider, resolvedModelId ?? undefined)} />
    ) : null;

  return (
    <aside
      className={`rounded-lg border p-3 text-[10px] leading-snug ${className}`}
      style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--muted2)" }}
      aria-label="Model provider API limits for selected model"
    >
      <p className="mb-1.5 text-[11px] font-semibold" style={{ color: "var(--text)" }}>
        Selected model — provider limits
      </p>
      <p className="mb-2 text-[10px] leading-relaxed">{PROVIDER_LIMITS_INTRO}</p>
      <p className="mb-3 rounded border px-2 py-1.5 text-[10px] leading-relaxed" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
        {OREO_INGEST_NOTE}
      </p>
      {inner}
    </aside>
  );
}
