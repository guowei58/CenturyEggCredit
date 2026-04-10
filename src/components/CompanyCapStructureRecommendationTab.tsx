"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Card } from "@/components/ui";
import { type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { modelOverridePayloadForProvider } from "@/lib/ai-model-prefs-client";
import { AiModelPicker } from "@/components/AiModelPicker";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { mergeCreditMemoDraftAfterIngest, parseCreditMemoDraftJson } from "@/lib/creditMemo/clientDraftStorage";
import { fetchSavedFromServer } from "@/lib/saved-data-client";
import type { CreditMemoProject, FolderResolveResult } from "@/lib/creditMemo/types";

const FIELD_CLASS =
  "w-full rounded border px-2 py-1 border-[var(--border2)] bg-[var(--card2)] text-[var(--text)] caret-[var(--accent)] shadow-sm [&::placeholder]:text-[var(--muted2)]";

const GEN_BTN_CLASS =
  "inline-flex min-h-[3.5rem] w-[17.5rem] shrink-0 items-center justify-center rounded border px-3 py-2 text-center text-sm font-semibold leading-snug disabled:opacity-50";

export function CompanyCapStructureRecommendationTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();

  const [provider, setProvider] = useState<AiProvider>("claude");
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolved, setResolved] = useState<FolderResolveResult | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [project, setProject] = useState<CreditMemoProject | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);

  const draftHydratedRef = useRef(false);

  useEffect(() => {
    if (!prefsReady) return;
    const n = normalizeAiProvider(preferences.aiProvider);
    if (n) setProvider(n);
  }, [prefsReady, preferences.aiProvider]);

  /** Hydrate shared ingest project + saved recommendation from server. */
  useEffect(() => {
    draftHydratedRef.current = false;
    if (!tk || !prefsReady) return;

    const raw = preferences.creditMemoDrafts?.[tk];
    const d = raw ? parseCreditMemoDraftJson(raw, tk) : null;
    if (d?.project) setProject(d.project);
    else setProject(null);

    void (async () => {
      const saved = await fetchSavedFromServer(tk, "cs-recommendation-latest");
      if (saved?.trim()) setMarkdown(saved);
      const metaRaw = await fetchSavedFromServer(tk, "cs-recommendation-latest-meta");
      if (metaRaw?.trim()) {
        try {
          const meta = JSON.parse(metaRaw) as { jobId?: string };
          if (typeof meta.jobId === "string") setJobId(meta.jobId);
        } catch {
          /* ignore */
        }
      }
      draftHydratedRef.current = true;
    })();
  }, [tk, prefsReady, preferences.creditMemoDrafts?.[tk]]);

  const runIngestRef = useRef<(pathOverride: string, resolutionMeta: FolderResolveResult | null) => Promise<void>>(
    () => Promise.resolve()
  );

  const runIngest = useCallback(
    async (folderPath: string, resolutionOverride?: FolderResolveResult | null) => {
      const pathToUse = folderPath.trim();
      const resolutionMeta = resolutionOverride ?? resolved;
      if (!tk || !pathToUse) {
        setIngestError("Resolve did not return a folder path.");
        return;
      }
      setIngestLoading(true);
      setIngestError(null);
      try {
        const res = await fetch("/api/credit-memo/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: tk,
            folderPath: pathToUse,
            resolutionMeta,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          project?: CreditMemoProject;
          error?: string;
          ingestWarnings?: string[];
        };
        if (!res.ok) throw new Error(data.error || "Ingest failed");
        const nextProject = data.project!;
        const prevId = project?.id;
        setProject(nextProject);
        if (prevId && nextProject.id !== prevId) {
          setMarkdown(null);
          setJobId(null);
        }
        updatePreferences((p) => ({
          ...p,
          creditMemoDrafts: {
            ...(p.creditMemoDrafts ?? {}),
            [tk]: mergeCreditMemoDraftAfterIngest(p.creditMemoDrafts?.[tk], tk, nextProject, prevId),
          },
        }));
        if (data.ingestWarnings?.length) {
          setIngestError(data.ingestWarnings.join(" "));
        }
      } catch (e) {
        setIngestError(e instanceof Error ? e.message : "Ingest failed");
      } finally {
        setIngestLoading(false);
      }
    },
    [tk, resolved, project?.id, updatePreferences]
  );

  runIngestRef.current = (folderPath, resolutionMeta) => runIngest(folderPath, resolutionMeta);

  const runResolve = useCallback(async () => {
    if (!tk) return;
    setResolveLoading(true);
    setResolved(null);
    setProject(null);
    setIngestError(null);
    let success: FolderResolveResult | null = null;
    try {
      const res = await fetch("/api/credit-memo/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk }),
      });
      const data = (await res.json()) as FolderResolveResult | { error?: string };
      if (!res.ok) throw new Error((data as { error?: string }).error || "Resolve failed");
      const fr = data as FolderResolveResult;
      success = fr;
      setResolved(fr);
    } catch (e) {
      setResolved({
        ok: false,
        rootSearched: "",
        candidates: [],
        error: e instanceof Error ? e.message : "Resolve failed",
      });
    } finally {
      setResolveLoading(false);
    }
    if (success?.ok) {
      await runIngestRef.current(success.chosen.path, success);
    }
  }, [tk]);

  useEffect(() => {
    if (!tk || !draftHydratedRef.current || authStatus !== "authenticated") return;
    if (project) return;
    if (resolved !== null) return;
    if (resolveLoading || ingestLoading) return;
    void runResolve();
  }, [tk, authStatus, project, resolved, resolveLoading, ingestLoading, runResolve]);

  const runGenerate = useCallback(async () => {
    if (!project) {
      setGenError("Run Refresh Source, Ingest & Index first.");
      return;
    }
    setGenLoading(true);
    setGenError(null);
    try {
      const res = await fetch(
        `/api/credit-memo/project/${encodeURIComponent(project.id)}/capital-structure-recommendation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            companyName: companyName?.trim() ?? "",
            ...modelOverridePayloadForProvider(provider),
          }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        jobId?: string;
        markdown?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setJobId(data.jobId ?? null);
      setMarkdown(data.markdown ?? null);
    } catch (e) {
      if (e instanceof Error) {
        const msg = e.message || "Generation failed";
        if (msg.toLowerCase().includes("fetch failed") || msg.toLowerCase().includes("failed to fetch")) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          setGenError(
            `Server unreachable (network error). Make sure the dev server is running${origin ? ` (${origin})` : ""}.`
          );
          return;
        }
        setGenError(msg);
      } else {
        setGenError("Generation failed");
      }
    } finally {
      setGenLoading(false);
    }
  }, [project, provider, companyName]);

  if (!tk) {
    return (
      <Card title="Recommendation">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker to generate capital-structure trade recommendations.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title={`Recommendation — ${tk}`}>
        <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Uses the same <strong>resolve → ingest → indexed source pack</strong> pipeline as AI Memo and Deck. When signed in, server-side
          ticker workspace files and saved tabs are included automatically. Refresh rebuilds the pack the model must cite. Output is
          saved as <code className="text-[10px]">cs-recommendation-latest.md</code> (separate from the manual Trade Recommendations note
          tab file).
        </p>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
                Ticker
              </div>
              <input readOnly value={tk} className={`${FIELD_CLASS} font-mono text-sm`} />
            </div>
            <button
              type="button"
              disabled={resolveLoading || ingestLoading}
              onClick={() => void runResolve()}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              {resolveLoading ? "Scanning…" : ingestLoading ? "Ingesting…" : "Refresh Source, Ingest & Index"}
            </button>
          </div>

          {resolved && !resolved.ok ? (
            <div className="rounded border border-dashed p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
              {resolved.error}
            </div>
          ) : null}

          {ingestError ? (
            <p className="text-xs" style={{ color: "var(--warn)" }}>
              {ingestError}
            </p>
          ) : null}

          {project ? (
            <div className="max-h-[40vh] space-y-2 overflow-auto rounded border p-3 text-xs" style={{ borderColor: "var(--border2)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Indexed files
              </div>
              <p style={{ color: "var(--muted2)" }}>
                {project.sources.length} files — {project.chunks.length} chunks. Warnings:{" "}
                {project.ingestWarnings?.length ? project.ingestWarnings.join("; ") : "none"}
              </p>
              <ul className="space-y-1 font-mono text-[10px]">
                {project.sources.map((s) => (
                  <li key={s.id}>
                    {s.relPath} · {s.category} · {s.parseStatus} · {s.charExtracted}c
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              After a successful refresh, indexed files appear here. On first load, this runs automatically when you are signed in.
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
              LLM
            </div>
            <select
              value={provider}
              onChange={(e) => {
                const v = e.target.value as AiProvider;
                setProvider(v);
                if (prefsReady) {
                  updatePreferences((p) => (p.aiProvider === v ? p : { ...p, aiProvider: v }));
                }
              }}
              className={FIELD_CLASS}
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini (Google)</option>
              <option value="deepseek">DeepSeek</option>
            </select>
            <AiModelPicker provider={provider} className="mt-2" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-stretch gap-3">
          <button
            type="button"
            disabled={genLoading || !project}
            onClick={() => void runGenerate()}
            className={GEN_BTN_CLASS}
            style={{
              borderColor: "var(--accent)",
              background: "var(--accent)",
              color: "var(--background,var(--text-invert,#fff))",
            }}
          >
            {genLoading ? "Generating recommendations (may take several minutes)…" : "Generate capital structure recommendations"}
          </button>
        </div>
        {genError ? <p className="mt-2 text-sm" style={{ color: "var(--warn)" }}>{genError}</p> : null}
        {jobId ? <p className="mt-1 text-[10px] font-mono" style={{ color: "var(--muted)" }}>Job: {jobId}</p> : null}
      </Card>

      {markdown?.trim() ? (
        <Card title="Latest output">
          <div
            className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed"
            style={{ color: "var(--text)" }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
