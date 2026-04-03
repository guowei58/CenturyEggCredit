"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

const OPENCORPORATES_HOME = "https://opencorporates.com/";

type SubsidiaryHintsApi =
  | { ok: true; companyName: string; names: string[]; sources: string[]; disclaimer: string }
  | { ok: false; message: string };

function openCorporatesSearchUrl(entityName: string): string {
  return `https://opencorporates.com/companies?q=${encodeURIComponent(entityName)}`;
}

export function CompanyEntitySearchesTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const name = (companyName ?? "").trim();
  const query = name || tk;
  const searchUrl = query ? openCorporatesSearchUrl(query) : OPENCORPORATES_HOME;

  const [hints, setHints] = useState<Extract<SubsidiaryHintsApi, { ok: true }> | null>(null);
  const [hintsErr, setHintsErr] = useState<string | null>(null);
  const [hintsLoading, setHintsLoading] = useState(false);

  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setHints(null);
    setHintsErr(null);
    setHintsLoading(true);
    fetch(`/api/subsidiary-hints/${encodeURIComponent(tk)}`)
      .then((r) => r.json() as Promise<SubsidiaryHintsApi>)
      .then((body) => {
        if (cancelled) return;
        if (body.ok) {
          setHints(body);
          setHintsErr(null);
        } else {
          setHints(null);
          setHintsErr(body.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHints(null);
          setHintsErr("Could not load subsidiary names.");
        }
      })
      .finally(() => {
        if (!cancelled) setHintsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tk]);

  const registrant = hints?.companyName ?? (name || tk);
  const subsidiaryNames = (hints?.names ?? []).filter(
    (n) => n.replace(/\s+/g, " ").trim().toLowerCase() !== registrant.toLowerCase()
  );

  return (
    <div className="space-y-4">
      <Card title="Subsidiaries & legal entities">
        <div className="space-y-3 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Names below are a <strong className="font-semibold text-[var(--text)]">best-effort</strong> extract from your
            saved Subsidiary List (if any), Exhibit 21 in the latest 10-K (embedded or standalone), and the SEC registrant
            name—not a ranked “materiality” list. Confirm important entities in filings and on OpenCorporates.
          </p>
          {!tk ? (
            <p>Select a company to load subsidiary hints.</p>
          ) : hintsLoading ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Loading subsidiary names from SEC sources…
            </p>
          ) : hintsErr ? (
            <div className="rounded border border-dashed px-3 py-2 text-xs" style={{ borderColor: "var(--border2)" }}>
              <p style={{ color: "var(--muted2)" }}>{hintsErr}</p>
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                Tip: use the <strong className="text-[var(--text)]">Subsidiary List</strong> tab to save a model or analyst
                list—those names are merged into this view on refresh.
              </p>
            </div>
          ) : hints && hints.names.length > 0 ? (
            <>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  Registrant (SEC)
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span style={{ color: "var(--text)" }}>{registrant}</span>
                  <a
                    href={openCorporatesSearchUrl(registrant)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] underline"
                    style={{ color: "var(--accent)" }}
                  >
                    OpenCorporates
                  </a>
                </div>
              </div>
              {subsidiaryNames.length > 0 ? (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Subsidiaries & other named entities ({subsidiaryNames.length})
                  </div>
                  <ul className="max-h-[min(28rem,55vh)] space-y-1.5 overflow-y-auto rounded border p-2 text-sm" style={{ borderColor: "var(--border2)" }}>
                    {subsidiaryNames.map((n) => (
                      <li key={n} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/50 pb-1.5 last:border-b-0 last:pb-0">
                        <span className="min-w-0 flex-1" style={{ color: "var(--text)" }}>
                          {n}
                        </span>
                        <a
                          href={openCorporatesSearchUrl(n)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-[11px] underline"
                          style={{ color: "var(--accent)" }}
                        >
                          Search OC
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Only the registrant name was found in the current sources. Add or refresh your Subsidiary List, or
                  ensure the latest 10-K loads for this ticker.
                </p>
              )}
              {hints.sources.length > 0 ? (
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                  <span className="font-semibold" style={{ color: "var(--muted2)" }}>Sources: </span>
                  {hints.sources.join(" · ")}
                </div>
              ) : null}
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {hints.disclaimer}
              </p>
            </>
          ) : null}
        </div>
      </Card>

      <Card title="OpenCorporates (manual search)">
        <div className="space-y-4 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          <p style={{ color: "var(--muted2)" }}>
            You can search for this company’s legal entities and related registrations on{" "}
            <a
              href={OPENCORPORATES_HOME}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
              style={{ color: "var(--accent)" }}
            >
              OpenCorporates
            </a>
            — a public index of companies and officers. Use the site’s search to explore subsidiaries, alternate names, and
            jurisdictions.
          </p>
          {query ? (
            <p>
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded border px-3 py-2 font-medium no-underline"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                Search OpenCorporates for “{query}”
              </a>
            </p>
          ) : null}
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            An integrated OpenCorporates API is not wired here — their API pricing is a poor fit for typical personal use.
            Manual search on the site is the intended workflow.
          </p>
        </div>
      </Card>
    </div>
  );
}
