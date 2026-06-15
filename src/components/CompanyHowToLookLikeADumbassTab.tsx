"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import {
  fetchCreditMemoProjectClient,
  mergeCreditMemoDraftAfterIngest,
  parseCreditMemoDraftJson,
  patchPreferencesCreditMemoDraftProject,
} from "@/lib/creditMemo/clientDraftStorage";
import { fetchLatestGeneratedTabOutput } from "@/lib/creditMemo/fetchLatestTabOutput";
import type { CreditMemoProject, FolderResolveResult } from "@/lib/creditMemo/types";
import { sanitizeWorkspaceKey } from "@/lib/company-workspace-key";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

/**
 * Same resolve → ingest pipeline as Biblical References; distressed bear-case prompt server-side.
 */
export function CompanyHowToLookLikeADumbassTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  const tk = sanitizeWorkspaceKey(ticker ?? "") ?? "";
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();

  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolved, setResolved] = useState<FolderResolveResult | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [project, setProject] = useState<CreditMemoProject | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [targetSecurity, setTargetSecurity] = useState("");
  const [tradingPrice, setTradingPrice] = useState("50c on the dollar");

  const draftHydratedRef = useRef(false);

  useEffect(() => {
    draftHydratedRef.current = false;
    setGenError(null);
    if (!tk || !prefsReady) return;

    const raw = preferences.creditMemoDrafts?.[tk];
    const d = raw ? parseCreditMemoDraftJson(raw, tk) : null;
    if (d?.project) {
      setProject(d.project);
      void fetchCreditMemoProjectClient(d.project.id).then((p) => {
        if (p) setProject(p);
      });
    } else setProject(null);

    void (async () => {
      const { markdown: m } = await fetchLatestGeneratedTabOutput(tk, "howToLookLikeADumbass");
      setMarkdown(m);
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
      if (!tk || !pathToUse) return;
      setIngestLoading(true);
      try {
        const res = await fetch("/api/credit-memo/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: tk,
            folderPath: pathToUse,
            resolutionMeta,
            workProductIngestScope: "dumbass",
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
        updatePreferences((p) => ({
          ...p,
          creditMemoDrafts: {
            ...(p.creditMemoDrafts ?? {}),
            [tk]: mergeCreditMemoDraftAfterIngest(p.creditMemoDrafts?.[tk], tk, nextProject, prevId),
          },
        }));
      } catch {
        /* optional background ingest — non-fatal */
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
    } catch {
      setResolved({
        ok: false,
        rootSearched: "",
        candidates: [],
        error: "Resolve failed",
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
    // Optional background prep — failures are non-fatal; Generate uses saved memo + tab text directly.
    void runResolve();
  }, [tk, authStatus, project, resolved, resolveLoading, ingestLoading, runResolve]);

  const runGenerate = useCallback(async () => {
    if (!tk) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const url = project?.id
        ? `/api/credit-memo/project/${encodeURIComponent(project.id)}/how-to-look-like-a-dumbass`
        : `/api/credit-memo/ticker/${encodeURIComponent(tk)}/how-to-look-like-a-dumbass`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName?.trim() ?? "",
          targetSecurity: targetSecurity.trim(),
          tradingPrice: tradingPrice.trim(),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        markdown?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setMarkdown(data.markdown ?? null);
      if (project?.id) {
        const np = await fetchCreditMemoProjectClient(project.id);
        if (np) {
          setProject(np);
          updatePreferences((p) => patchPreferencesCreditMemoDraftProject(p, tk, np));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generation failed";
      setGenError(
        /fetch failed|failed to fetch/i.test(msg)
          ? "Request failed — check your connection and try again. Generation uses saved tab text from your account; folder ingest is optional."
          : msg
      );
    } finally {
      setGenLoading(false);
    }
  }, [project, companyName, targetSecurity, tradingPrice, tk, updatePreferences]);

  if (!tk) {
    return (
      <Card title="How to Look Like a Dumbass">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company (ticker or CIK).
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const busy = resolveLoading || ingestLoading || genLoading;

  return (
    <Card title={`How to Look Like a Dumbass — ${tk}`}>
      {needsSignIn ? (
        <p className="text-xs mb-3 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
          Sign in to run this tab. It uses the same ingested research folder as <strong>AI Memo and Deck</strong> /{" "}
          <strong>Recommendation</strong> (resolve → ingest). Primary input is a saved credit memo (default or voice); if none is long
          enough, saved tab <strong>.txt</strong> response files and other ingested files are used.
        </p>
      ) : null}

      {genError ? (
        <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
          {genError}
        </p>
      ) : null}

      {!needsSignIn ? (
        <div className="mb-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs" style={{ color: "var(--muted2)" }}>
              Target security (optional)
              <input
                type="text"
                value={targetSecurity}
                onChange={(e) => setTargetSecurity(e.target.value)}
                placeholder="e.g. 2029 unsecured notes"
                className="mt-1 w-full rounded border bg-[var(--card2)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                style={{ borderColor: "var(--border2)" }}
              />
            </label>
            <label className="block text-xs" style={{ color: "var(--muted2)" }}>
              Current trading price
              <input
                type="text"
                value={tradingPrice}
                onChange={(e) => setTradingPrice(e.target.value)}
                placeholder="50c on the dollar"
                className="mt-1 w-full rounded border bg-[var(--card2)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                style={{ borderColor: "var(--border2)" }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={genLoading}
              onClick={() => void runGenerate()}
              className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {genLoading ? "Working…" : markdown?.trim() ? "Refresh" : "Generate"}
            </button>
            {!project && !genLoading ? (
              <span className="text-xs" style={{ color: "var(--muted2)" }}>
                Uses your saved credit memo plus saved tab responses. Folder ingest improves context but is not required to run Generate.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {busy ? (
        <p className="text-sm mb-3 flex items-center gap-2" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          {genLoading
            ? "Generating distressed bear-case memo (best available model)…"
            : "Preparing workspace (resolve / ingest)…"}
        </p>
      ) : null}

      {markdown?.trim() ? (
        <div className="prose-covenants text-sm leading-relaxed max-w-none" style={{ color: "var(--text)" }}>
          <SavedRichText content={markdown} ticker={tk} />
        </div>
      ) : !busy ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No output yet. Click <strong>Generate</strong> once you have a saved memo on <strong>AI Memo and Deck</strong> and/or saved tab responses.
        </p>
      ) : null}
    </Card>
  );
}
