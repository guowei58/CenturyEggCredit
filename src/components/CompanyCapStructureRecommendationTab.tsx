"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { WorkProductIngestTabLayout } from "@/components/credit-memo/WorkProductIngestTabLayout";
import { type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { modelOverridePayloadForProvider } from "@/lib/ai-model-prefs-client";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { mergeCreditMemoDraftAfterIngest, parseCreditMemoDraftJson } from "@/lib/creditMemo/clientDraftStorage";
import { fetchLatestGeneratedTabOutput } from "@/lib/creditMemo/fetchLatestTabOutput";
import type { CreditMemoProject, FolderResolveResult } from "@/lib/creditMemo/types";

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

  const persistProvider = useCallback(
    (p: AiProvider) => {
      setProvider(p);
      updatePreferences((prev) => ({ ...prev, aiProvider: p }));
    },
    [updatePreferences]
  );

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
      const { markdown: m, jobId: j } = await fetchLatestGeneratedTabOutput(tk, "recommendation");
      setMarkdown(m);
      setJobId(j);
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
          const { markdown: m, jobId: j } = await fetchLatestGeneratedTabOutput(tk, "recommendation");
          setMarkdown(m);
          setJobId(j);
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
      setGenError("Refresh sources first (resolve → ingest → index).");
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
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker to generate capital-structure trade recommendations.
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const refreshingSources = resolveLoading || ingestLoading;
  const resolveFailed = resolved && !resolved.ok ? { error: resolved.error } : null;
  const refreshLabel = resolveLoading ? "Scanning…" : ingestLoading ? "Ingesting…" : "Refresh sources";

  return (
    <WorkProductIngestTabLayout
      tabTitle="Recommendation"
      ticker={tk}
      description={
        <>
          Uses the same <strong>resolve → ingest → indexed source pack</strong> pipeline as AI Memo and Deck. When signed in, server-side
          ticker workspace files and saved tabs are included automatically. Refresh rebuilds the pack the model must cite. Output is saved
          as <code className="text-[10px]">cs-recommendation-latest.md</code> (separate from the manual Trade Recommendations note tab
          file).
        </>
      }
      needsSignIn={needsSignIn}
      refreshingSources={refreshingSources}
      hasProject={Boolean(project)}
      aiProvider={provider}
      onProviderChange={persistProvider}
      onRefreshSources={runResolve}
      refreshDisabled={resolveLoading || ingestLoading}
      refreshLabel={refreshLabel}
      onRun={runGenerate}
      runDisabled={genLoading || !project}
      runBusy={genLoading}
      runLabel="Generate capital structure recommendations"
      runLoadingLabel="Generating recommendations…"
      resolveFailed={resolveFailed}
      ingestError={ingestError}
      genError={genError}
      jobId={jobId}
      project={project}
      outputCardTitle="Capital structure recommendation output"
      markdown={markdown}
      emptyOutputMessage={
        <>No saved recommendation yet for this ticker. After you generate, it stays here when you switch tabs or reload.</>
      }
    />
  );
}
