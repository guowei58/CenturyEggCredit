"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { CreditDecisionDashboardView } from "@/components/CreditDecisionDashboardView";
import {
  fetchCreditMemoProjectClient,
  mergeCreditMemoDraftAfterIngest,
  parseCreditMemoDraftJson,
  patchPreferencesCreditMemoDraftProject,
} from "@/lib/creditMemo/clientDraftStorage";
import type { CreditDecisionDashboardInputs, CreditDecisionDashboardPayload } from "@/lib/creditMemo/creditDecisionDashboardTypes";
import { EMPTY_CREDIT_DECISION_DASHBOARD_INPUTS } from "@/lib/creditMemo/creditDecisionDashboardTypes";
import { parseCreditDecisionDashboardJson } from "@/lib/creditMemo/parseCreditDecisionDashboardJson";
import type { CreditMemoProject, FolderResolveResult } from "@/lib/creditMemo/types";
import { fetchSavedFromServer } from "@/lib/saved-data-client";
import { sanitizeWorkspaceKey } from "@/lib/company-workspace-key";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

const ANALYST_VIEWS = ["Buy", "Hold", "Pass", "Short", "Watchlist"] as const;
const SECURITY_RANKINGS = [
  "first lien",
  "second lien",
  "unsecured",
  "structurally subordinated",
  "preferred",
  "other",
] as const;

const inputClass =
  "mt-0.5 w-full rounded border bg-[var(--card2)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none";

export function CompanyCreditDecisionDashboardTab({
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
  const [dashboard, setDashboard] = useState<CreditDecisionDashboardPayload | null>(null);
  const [inputs, setInputs] = useState<CreditDecisionDashboardInputs>(EMPTY_CREDIT_DECISION_DASHBOARD_INPUTS);

  const draftHydratedRef = useRef(false);

  useEffect(() => {
    draftHydratedRef.current = false;
    setGenError(null);
    setDashboard(null);
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
      const [dashRaw, inputsRaw] = await Promise.all([
        fetchSavedFromServer(tk, "credit-decision-dashboard-latest"),
        fetchSavedFromServer(tk, "credit-decision-dashboard-inputs"),
      ]);
      if (dashRaw?.trim()) {
        const parsed = parseCreditDecisionDashboardJson(dashRaw);
        if (parsed) setDashboard(parsed);
      }
      if (inputsRaw?.trim()) {
        try {
          const o = JSON.parse(inputsRaw) as Partial<CreditDecisionDashboardInputs>;
          setInputs((prev) => ({
            ...prev,
            ...o,
            ticker: o.ticker?.trim() || tk,
            companyName: o.companyName?.trim() || companyName?.trim() || prev.companyName,
          }));
        } catch {
          /* ignore */
        }
      } else {
        setInputs((prev) => ({
          ...prev,
          ticker: tk,
          companyName: companyName?.trim() || prev.companyName,
        }));
      }
      draftHydratedRef.current = true;
    })();
  }, [tk, prefsReady, companyName, preferences.creditMemoDrafts?.[tk]]);

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
            workProductIngestScope: "credit-dashboard",
          }),
        });
        const data = (await res.json()) as { ok?: boolean; project?: CreditMemoProject; error?: string };
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
        /* optional background ingest */
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
      success = data as FolderResolveResult;
      setResolved(success);
    } catch {
      setResolved({ ok: false, rootSearched: "", candidates: [], error: "Resolve failed" });
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

  const patchInput = useCallback(<K extends keyof CreditDecisionDashboardInputs>(key: K, value: CreditDecisionDashboardInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const runGenerate = useCallback(async () => {
    if (!tk) return;
    setGenLoading(true);
    setGenError(null);
    const payload: CreditDecisionDashboardInputs = {
      ...inputs,
      ticker: inputs.ticker.trim() || tk,
      companyName: inputs.companyName.trim() || companyName?.trim() || tk,
    };
    try {
      const url = project?.id
        ? `/api/credit-memo/project/${encodeURIComponent(project.id)}/credit-decision-dashboard`
        : `/api/credit-memo/ticker/${encodeURIComponent(tk)}/credit-decision-dashboard`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        dashboard?: CreditDecisionDashboardPayload;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Generation failed");
      if (data.dashboard) setDashboard(data.dashboard);
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
          ? "Request failed — check your connection and try again."
          : msg
      );
    } finally {
      setGenLoading(false);
    }
  }, [project, companyName, inputs, tk, updatePreferences]);

  if (!tk) {
    return (
      <Card title="Credit Decision Dashboard">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company (ticker or CIK).
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const busy = resolveLoading || ingestLoading || genLoading;

  return (
    <Card title={`Credit Decision Dashboard — ${tk}`}>
      {needsSignIn ? (
        <p className="text-xs mb-3 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
          Sign in to generate. Uses saved memos, response boxes, and work products for this workspace.
        </p>
      ) : null}

      {genError ? (
        <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
          {genError}
        </p>
      ) : null}

      {!needsSignIn ? (
        <div className="mb-3 rounded border p-3 space-y-2" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Security & analyst inputs
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Company name
              <input type="text" value={inputs.companyName} onChange={(e) => patchInput("companyName", e.target.value)} className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Ticker
              <input type="text" value={inputs.ticker || tk} onChange={(e) => patchInput("ticker", e.target.value)} className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Security analyzed
              <input type="text" value={inputs.securityAnalyzed} onChange={(e) => patchInput("securityAnalyzed", e.target.value)} placeholder="2028 unsecured notes" className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Current price
              <input type="text" value={inputs.currentPrice} onChange={(e) => patchInput("currentPrice", e.target.value)} placeholder="82" className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Yield / spread
              <input type="text" value={inputs.currentYieldSpread} onChange={(e) => patchInput("currentYieldSpread", e.target.value)} placeholder="12% YTM" className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Maturity
              <input type="text" value={inputs.maturity} onChange={(e) => patchInput("maturity", e.target.value)} className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Coupon
              <input type="text" value={inputs.coupon} onChange={(e) => patchInput("coupon", e.target.value)} className={inputClass} style={{ borderColor: "var(--border2)" }} />
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Security ranking
              <select value={inputs.securityRanking} onChange={(e) => patchInput("securityRanking", e.target.value)} className={inputClass} style={{ borderColor: "var(--border2)" }}>
                <option value="">—</option>
                {SECURITY_RANKINGS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
              Analyst current view
              <select value={inputs.analystView} onChange={(e) => patchInput("analystView", e.target.value)} className={inputClass} style={{ borderColor: "var(--border2)" }}>
                <option value="">—</option>
                {ANALYST_VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-[10px]" style={{ color: "var(--muted2)" }}>
            Notes / manual analyst override
            <textarea
              value={inputs.analystNotes}
              onChange={(e) => patchInput("analystNotes", e.target.value)}
              rows={2}
              className={inputClass}
              style={{ borderColor: "var(--border2)" }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={genLoading}
              onClick={() => void runGenerate()}
              className="rounded border px-4 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {genLoading ? "Generating…" : dashboard ? "Refresh dashboard" : "Generate dashboard"}
            </button>
            <span className="text-[10px]" style={{ color: "var(--muted2)" }}>
              Synthesizes saved research — not a long memo. Blank fields OK.
            </span>
          </div>
        </div>
      ) : null}

      {busy ? (
        <p className="text-xs mb-3 flex items-center gap-2" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          {genLoading ? "Building credit decision dashboard…" : "Preparing workspace…"}
        </p>
      ) : null}

      {dashboard && !busy ? (
        <CreditDecisionDashboardView data={dashboard} />
      ) : !busy && !needsSignIn ? (
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          No dashboard yet. Fill security inputs (optional), then click <strong>Generate dashboard</strong> once you have saved research on this workspace.
        </p>
      ) : null}
    </Card>
  );
}
