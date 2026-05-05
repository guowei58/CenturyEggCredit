"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui";
import { aiProviderChipStyle, type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { modelOverridePayloadForProvider, modelPayloadForRun } from "@/lib/ai-model-prefs-client";
import { AiModelPicker } from "@/components/AiModelPicker";
import { resolveDebtDocumentDisplayTitle } from "@/lib/creditDocs/sanitizeSecInstrumentTitle";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { SUBSIDIARY_LIST_PROMPT_TEMPLATE } from "@/data/subsidiary-list-prompt";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";
import { SavedRichText } from "@/components/SavedRichText";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";

import type {
  EntityMapperEvidence,
  EntityMapperV2Snapshot,
  FacilityFamilyMatrix,
  MatrixCell,
} from "@/lib/entity-mapper-v2/types";

type Exhibit21Row = EntityMapperV2Snapshot["exhibit21Universe"][number];

type MapperGetResponse = {
  ticker: string;
  needsSignIn?: boolean;
  exhibit21Universe: Exhibit21Row[];
  profileUpdatedAtIso: string | null;
  snapshot: EntityMapperV2Snapshot | null;
  anthropicConfigured: boolean;
  openaiConfigured: boolean;
  geminiConfigured?: boolean;
  deepseekConfigured?: boolean;
  deepseekDefaultModel?: string;
};

function cellGlyph(c: MatrixCell | undefined): string {
  if (!c) return "—";
  if (c.symbol === "yes") return "✅";
  if (c.symbol === "no") return "❌";
  if (c.symbol === "question") return "?";
  return "—";
}

/** Rows with only “not stated” cells and no evidence are omitted from matrices. */
function facilityMatrixRowHasFinancingSignal(row: FacilityFamilyMatrix["rows"][string]): boolean {
  if (row.source_evidence_count > 0) return true;
  return Object.values(row.cells).some((c) => c.symbol !== "dash" || (c.evidence_ids?.length ?? 0) > 0);
}

export function CompanyEntityMapperTab({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const safeTicker = ticker?.trim() ?? "";
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const [data, setData] = useState<MapperGetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedDocs, setLastSavedDocs] = useState<{ saved: number; failed: number } | null>(null);
  const [discoverSec, setDiscoverSec] = useState(true);
  const [downloadExhibits, setDownloadExhibits] = useState(true);
  const [aiProvider, setAiProvider] = useState<AiProvider>("claude");
  const [runPhase, setRunPhase] = useState<null | "pipeline" | "subsidiary-list">(null);
  const [subsidiaryListMarkdown, setSubsidiaryListMarkdown] = useState("");
  const [subsidiaryListError, setSubsidiaryListError] = useState<string | null>(null);

  const [cellModal, setCellModal] = useState<{
    familyLabel: string;
    subsidiary: string;
    role: string;
    cell: MatrixCell;
  } | null>(null);

  useEffect(() => {
    if (!prefsReady) return;
    const n = normalizeAiProvider(preferences.aiProvider);
    if (n) setAiProvider(n);
  }, [prefsReady, preferences.aiProvider]);

  const persistProvider = useCallback(
    (p: AiProvider) => {
      setAiProvider(p);
      updatePreferences((prev) => ({ ...prev, aiProvider: p }));
    },
    [updatePreferences]
  );

  const { template: subsidiaryListTemplate } = usePromptTemplateOverride(
    "subsidiary-list",
    SUBSIDIARY_LIST_PROMPT_TEMPLATE
  );
  const subsidiaryListUserPrompt = useMemo(
    () => (safeTicker ? subsidiaryListTemplate.replace(/\{\{TICKER\}\}/g, safeTicker) : ""),
    [subsidiaryListTemplate, safeTicker]
  );

  const load = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/entity-mapper/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as MapperGetResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load Entity Mapper");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [safeTicker]);

  useEffect(() => {
    if (!prefsReady || !safeTicker) return;
    void load();
  }, [prefsReady, safeTicker, load]);

  useEffect(() => {
    setCellModal(null);
    setLastSavedDocs(null);
    setSubsidiaryListError(null);
    setRunPhase(null);
  }, [safeTicker]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "subsidiary-list");
      if (!cancelled) setSubsidiaryListMarkdown(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  async function runPipeline() {
    if (!safeTicker) return;
    setRunning(true);
    setRunPhase("pipeline");
    setError(null);
    setSubsidiaryListError(null);
    setLastSavedDocs(null);
    let pipelineOk = false;
    try {
      const res = await fetch(`/api/entity-mapper/${encodeURIComponent(safeTicker)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiProvider,
          companyName: companyName?.trim() || undefined,
          discoverSecDocuments: discoverSec,
          downloadExhibitsToSavedDocs: downloadExhibits,
          maxSavedDocumentDownloads: 80,
          ...modelOverridePayloadForProvider(aiProvider),
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        savedDocumentsSummary?: { savedCount: number; failedCount: number } | null;
      };
      if (!res.ok) throw new Error(body.error ?? "Run failed");
      if (body.savedDocumentsSummary) {
        setLastSavedDocs({
          saved: body.savedDocumentsSummary.savedCount,
          failed: body.savedDocumentsSummary.failedCount,
        });
      }
      await load();
      pipelineOk = true;

      const prompt = subsidiaryListUserPrompt.trim();
      if (!prompt) {
        throw new Error("Subsidiary analysis prompt is empty (template missing ticker).");
      }
      setRunPhase("subsidiary-list");
      const slRes = await fetch("/api/tab-prompt-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiProvider,
          userPrompt: prompt,
          maxTokens: LLM_MAX_OUTPUT_TOKENS,
          ...modelPayloadForRun(aiProvider, "__saved__"),
        }),
      });
      const slJson = (await slRes.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
      if (!slRes.ok || slJson.ok !== true || typeof slJson.text !== "string") {
        throw new Error(slJson.error ?? `Subsidiary analysis API failed (${slRes.status})`);
      }
      const text = slJson.text.trim();
      setSubsidiaryListMarkdown(text);
      await saveToServer(safeTicker, "subsidiary-list", text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Run failed";
      if (pipelineOk) setSubsidiaryListError(msg);
      else setError(msg);
    } finally {
      setRunPhase(null);
      setRunning(false);
    }
  }

  const evidenceMap = useMemo(() => {
    const m = new Map<string, EntityMapperEvidence>();
    const ev = data?.snapshot?.evidence ?? [];
    for (const e of ev) m.set(e.id, e);
    return m;
  }, [data?.snapshot?.evidence]);

  const inventoryByFamily = useMemo(() => {
    const snap = data?.snapshot;
    const out = new Map<string, EntityMapperV2Snapshot["debtInventory"]>();
    if (!snap?.debtInventory?.length) return out;
    for (const it of snap.debtInventory) {
      const k = it.facilityInstrumentFamily || "Other financing arrangement";
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(it);
    }
    return out;
  }, [data?.snapshot]);

  const needsSignIn = authStatus !== "authenticated";
  const deepseekReady = data?.deepseekConfigured === true;
  const providerReady = data
    ? aiProvider === "claude"
      ? data.anthropicConfigured
      : aiProvider === "openai"
        ? data.openaiConfigured
        : aiProvider === "gemini"
          ? data.geminiConfigured === true
          : deepseekReady
    : false;

  const snap = data?.snapshot;

  if (!safeTicker) {
    return (
      <Card title="Entity Mapper">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to map Exhibit 21 subsidiaries to financing-document roles.
        </p>
      </Card>
    );
  }

  const stickyHeadBg = "var(--card2)";
  const stickyCellBg = "var(--card)";

  return (
    <div className="space-y-6">
      <Card title={`Entity Mapper — ${safeTicker}`}>
        <div className="min-w-0">
            <p className="text-[11px] leading-relaxed mb-4" style={{ color: "var(--muted2)" }}>
              Maps <strong>Public Records Exhibit 21</strong> subsidiaries to roles in debt documents. Run discovers EDGAR exhibits
              (optional), refreshes Saved Documents, then builds structured matrices with evidence — not a generic org chart.
            </p>

            {needsSignIn && (
              <p className="text-xs mb-4 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
                Sign in to load your Public Records profile and run the mapper.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
                Provider:
              </span>
              <div className="inline-flex rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
                <button
                  type="button"
                  onClick={() => persistProvider("claude")}
                  className="px-3 py-1.5 text-[11px] font-medium transition-colors"
                  style={aiProviderChipStyle(aiProvider, "claude")}
                >
                  Claude
                </button>
                <button
                  type="button"
                  onClick={() => persistProvider("openai")}
                  className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "openai") }}
                >
                  ChatGPT
                </button>
                <button
                  type="button"
                  onClick={() => persistProvider("gemini")}
                  className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "gemini") }}
                >
                  Gemini
                </button>
                <button
                  type="button"
                  onClick={() => persistProvider("deepseek")}
                  className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "deepseek") }}
                  title={`DeepSeek — ${data?.deepseekDefaultModel ?? "deepseek-chat"}`}
                >
                  DeepSeek
                </button>
              </div>
              <AiModelPicker provider={aiProvider} className="mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto" />
            </div>

            <div className="flex flex-wrap gap-4 mb-3 text-[11px]" style={{ color: "var(--muted2)" }}>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={discoverSec} onChange={(e) => setDiscoverSec(e.target.checked)} />
                Discover debt exhibits from EDGAR + update SEC index / Saved Documents
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={downloadExhibits}
                  onChange={(e) => setDownloadExhibits(e.target.checked)}
                  disabled={!discoverSec}
                />
                Download exhibits into Saved Documents (when discovering SEC)
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => void runPipeline()}
                disabled={running || loading || !prefsReady || needsSignIn || !providerReady}
                className="rounded border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{
                  borderColor: "var(--accent)",
                  background: "var(--accent)",
                  color: "var(--bg)",
                }}
              >
                {running
                  ? runPhase === "subsidiary-list"
                    ? "Generating AI subsidiary analysis…"
                    : "Running pipeline…"
                  : "Run Entity Mapper"}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={running || loading || !prefsReady}
                className="rounded border px-3 py-2 text-xs font-medium disabled:opacity-50"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                Refresh
              </button>
              {lastSavedDocs ? (
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  SEC exhibits saved: {lastSavedDocs.saved}
                  {lastSavedDocs.failed > 0 ? ` · failed ${lastSavedDocs.failed}` : ""}
                </span>
              ) : null}
            </div>

            {!providerReady && !needsSignIn && data && !loading && (
              <p className="text-xs mb-3 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
                Configure your AI provider API key (see Settings / env) or switch provider.
              </p>
            )}

            {loading && !data ? (
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                Loading…
              </p>
            ) : null}
            {error ? (
              <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            ) : null}

            {aiProvider === "deepseek" ? (
              <p className="text-[10px] mb-4 leading-snug" style={{ color: "var(--warn)" }}>
                DeepSeek output is capped (~8k tokens). For large universes, prefer Claude or GPT so JSON matrices are not truncated.
              </p>
            ) : null}
        </div>
      </Card>

      <Card title="1. Exhibit 21 subsidiary universe">
        <p className="text-[11px] mb-3" style={{ color: "var(--muted2)" }}>
          Pulled from your saved <strong>Public Records Profile</strong> (Exhibit 21 grid or name/domicile rows).
          Profile updated: {data?.profileUpdatedAtIso ? new Date(data.profileUpdatedAtIso).toLocaleString() : "—"}
        </p>
        {!data?.exhibit21Universe?.length ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No subsidiaries on file. Open Overview → Public Records Profile → Exhibit 21, save the profile, then Refresh.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border text-[11px]" style={{ borderColor: "var(--border2)" }}>
            <table className="w-full min-w-[480px] text-left">
              <thead style={{ background: stickyHeadBg, color: "var(--muted2)" }}>
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Legal name</th>
                  <th className="px-2 py-1.5 font-semibold">Jurisdiction</th>
                  <th className="px-2 py-1.5 font-semibold">Source filing</th>
                  <th className="px-2 py-1.5 font-semibold">Source date</th>
                </tr>
              </thead>
              <tbody>
                {data.exhibit21Universe.map((r) => (
                  <tr key={`${r.exhibit21LegalName}-${r.sourceDate}`} className="border-t" style={{ borderColor: "var(--border2)" }}>
                    <td className="px-2 py-1.5 align-top">{r.exhibit21LegalName}</td>
                    <td className="px-2 py-1.5 align-top">{r.jurisdiction || "—"}</td>
                    <td className="px-2 py-1.5 align-top">{r.sourceFiling}</td>
                    <td className="px-2 py-1.5 align-top whitespace-nowrap">{r.sourceDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="2. Debt document inventory">
        {!snap?.debtInventory?.length ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No inventory yet. Run Entity Mapper with SEC discovery enabled, or rely on prior snapshot after a successful run.
          </p>
        ) : (
          <div className="space-y-4">
            {[...inventoryByFamily.entries()].map(([fam, items]) => (
              <details key={fam} className="rounded border" style={{ borderColor: "var(--border2)" }} open>
                <summary
                  className="cursor-pointer px-3 py-2 text-xs font-semibold"
                  style={{ background: stickyHeadBg, color: "var(--muted2)" }}
                >
                  {fam} ({items.length})
                </summary>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full min-w-[960px] text-left text-[10px]">
                    <thead style={{ color: "var(--muted2)" }}>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-2 py-1">Document</th>
                        <th className="px-2 py-1">Type</th>
                        <th className="px-2 py-1">Form</th>
                        <th className="px-2 py-1">Filed</th>
                        <th className="px-2 py-1">Ex.</th>
                        <th className="px-2 py-1">Category</th>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1">Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={`${it.accessionNumber}-${idx}`} className="border-b" style={{ borderColor: "var(--border2)" }}>
                          <td className="px-2 py-1 align-top max-w-[200px] break-words">
                            {resolveDebtDocumentDisplayTitle(it.documentName, {
                              exhibitNumber: it.exhibitNumber,
                              filingForm: it.filingForm,
                              filingDate: it.filingDate,
                              directExhibitLink: it.directExhibitLink,
                            })}
                          </td>
                          <td className="px-2 py-1 align-top">{it.documentType}</td>
                          <td className="px-2 py-1 align-top">{it.filingForm}</td>
                          <td className="px-2 py-1 align-top whitespace-nowrap">{it.filingDate}</td>
                          <td className="px-2 py-1 align-top">{it.exhibitNumber}</td>
                          <td className="px-2 py-1 align-top">{it.docCategory}</td>
                          <td className="px-2 py-1 align-top">{it.currentHistoricalUnclear}</td>
                          <td className="px-2 py-1 align-top whitespace-nowrap">
                            <a
                              href={it.directExhibitLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                              style={{ color: "var(--accent)" }}
                            >
                              Exhibit
                            </a>
                            {" · "}
                            <a
                              href={it.filingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                              style={{ color: "var(--accent)" }}
                            >
                              Filing
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>

      <Card title="3. Entity–role matrices (per financing family)">
        {!snap?.facilityMatrices?.length ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No matrices yet. Run Entity Mapper after saving Exhibit 21 and adding financing text (Saved Documents / workspace).
          </p>
        ) : (
          <div className="space-y-8">
            {snap.facilityMatrices.map((fm) => {
              const matrixRows = Object.values(fm.rows).filter(facilityMatrixRowHasFinancingSignal);
              return (
              <div key={fm.familyId}>
                <h3 className="text-xs font-semibold mb-2" style={{ color: "var(--text)" }}>
                  {fm.familyLabel}
                </h3>
                {matrixRows.length === 0 ? (
                  <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                    No Exhibit 21 subsidiaries with a stated or evidenced financing role in this family (others omitted).
                  </p>
                ) : (
                <div className="w-full overflow-x-auto rounded border" style={{ borderColor: "var(--border2)" }}>
                  {(() => {
                    const subsidiaryPct = 26;
                    const evidencePct = 7;
                    const statusPct = 11;
                    const rolePctTotal = Math.max(0, 100 - subsidiaryPct - evidencePct - statusPct);
                    const perRolePct =
                      fm.roleColumns.length > 0 ? rolePctTotal / fm.roleColumns.length : rolePctTotal;
                    return (
                  <table className="w-full table-fixed text-left text-[10px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                    <colgroup>
                      <col style={{ width: `${subsidiaryPct}%` }} />
                      {fm.roleColumns.map((col, colIdx) => (
                        <col key={`${fm.familyId}-${col}-${colIdx}`} style={{ width: `${perRolePct}%` }} />
                      ))}
                      <col style={{ width: `${evidencePct}%` }} />
                      <col style={{ width: `${statusPct}%` }} />
                    </colgroup>
                    <thead>
                      <tr style={{ background: stickyHeadBg, color: "var(--muted2)" }}>
                        <th
                          className="sticky left-0 z-10 px-2 py-2 border-b border-r align-bottom font-semibold"
                          style={{ background: stickyHeadBg }}
                        >
                          Subsidiary
                        </th>
                        {fm.roleColumns.map((col) => (
                          <th
                            key={col}
                            className="px-2 py-2 border-b border-r font-semibold align-bottom text-[10px] leading-snug whitespace-normal break-words hyphens-auto"
                            style={{ wordBreak: "break-word" }}
                          >
                            {col}
                          </th>
                        ))}
                        <th className="px-2 py-2 border-b align-bottom font-semibold text-center leading-snug whitespace-normal">
                          Σ evidence
                        </th>
                        <th className="px-2 py-2 border-b align-bottom font-semibold leading-snug whitespace-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixRows.map((row) => (
                        <tr key={row.subsidiary_legal_name} className="border-b" style={{ borderColor: "var(--border2)" }}>
                          <td
                            className="sticky left-0 z-[1] px-2 py-2 border-r align-top font-medium break-words leading-snug"
                            style={{ background: stickyCellBg, wordBreak: "break-word" }}
                            title={row.subsidiary_legal_name}
                          >
                            {row.subsidiary_legal_name}
                          </td>
                          {fm.roleColumns.map((col) => {
                            const cell = row.cells[col] ?? { symbol: "dash" as const, evidence_ids: [] };
                            return (
                              <td key={col} className="px-1 py-1 border-r text-center align-middle">
                                <button
                                  type="button"
                                  className="w-full min-h-[32px] hover:opacity-80 text-[13px] leading-none px-1"
                                  style={{
                                    background:
                                      cell.symbol === "yes"
                                        ? "rgba(34,197,94,0.12)"
                                        : cell.symbol === "question"
                                          ? "rgba(234,179,8,0.12)"
                                          : cell.symbol === "no"
                                            ? "rgba(239,68,68,0.08)"
                                            : "transparent",
                                  }}
                                  onClick={() => {
                                    if (cell.symbol === "dash" && !cell.evidence_ids.length) return;
                                    setCellModal({
                                      familyLabel: fm.familyLabel,
                                      subsidiary: row.subsidiary_legal_name,
                                      role: col,
                                      cell,
                                    });
                                  }}
                                  title={
                                    cell.evidence_ids.length
                                      ? `${cell.evidence_ids.length} evidence row(s) — click`
                                      : "Not stated"
                                  }
                                >
                                  {cellGlyph(cell)}
                                </button>
                              </td>
                            );
                          })}
                          <td className="px-2 py-2 text-center tabular-nums align-middle">{row.source_evidence_count}</td>
                          <td className="px-2 py-2 text-[10px] align-middle leading-snug break-words">{row.status_summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                    );
                  })()}
                </div>
                )}
                <p className="text-[9px] mt-1" style={{ color: "var(--muted)" }}>
                  ✅ confirmed · — not stated · ? ambiguous · ❌ expressly excluded (per model + sources). Subsidiaries with no
                  role or evidence in this family are hidden.
                </p>
              </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="4. Consolidated current-role view">
        {!snap?.consolidated?.length ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No consolidated summary in snapshot yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border text-[11px]" style={{ borderColor: "var(--border2)" }}>
            <table className="w-full min-w-[560px] text-left">
              <thead style={{ background: stickyHeadBg, color: "var(--muted2)" }}>
                <tr>
                  <th className="px-2 py-1.5">Subsidiary</th>
                  <th className="px-2 py-1.5">Any current role?</th>
                  <th className="px-2 py-1.5">Summary</th>
                  <th className="px-2 py-1.5">Evidence IDs</th>
                  <th className="px-2 py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {snap.consolidated.map((r) => (
                  <tr key={r.subsidiary_legal_name} className="border-t" style={{ borderColor: "var(--border2)" }}>
                    <td className="px-2 py-1.5">{r.subsidiary_legal_name}</td>
                    <td className="px-2 py-1.5">{r.has_any_current_financing_role ? "Yes" : "No"}</td>
                    <td className="px-2 py-1.5 max-w-[280px]">{r.roles_summary}</td>
                    <td className="px-2 py-1.5 font-mono text-[9px] max-w-[120px]">
                      {r.evidence_ids?.length ? r.evidence_ids.join(", ") : "—"}
                    </td>
                    <td className="px-2 py-1.5 max-w-[200px]">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="5. Role change log">
        {!snap?.roleChangeLog?.length ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No chronological log in snapshot.
          </p>
        ) : (
          <ul className="space-y-2 text-[11px] list-disc pl-5" style={{ color: "var(--text)" }}>
            {snap.roleChangeLog.map((e, i) => (
              <li key={`${e.date}-${i}`}>
                <span className="font-semibold">{e.date}</span> — {e.entity}: {e.change}{" "}
                <span style={{ color: "var(--muted)" }}>({e.document})</span>
                {e.source_quote ? (
                  <blockquote className="mt-1 pl-2 border-l text-[10px] opacity-90" style={{ borderColor: "var(--border2)" }}>
                    {e.source_quote.slice(0, 400)}
                    {e.source_quote.length > 400 ? "…" : ""}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="6. Ambiguities / missing evidence">
        {!snap?.ambiguities?.length ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            None listed, or run not completed.
          </p>
        ) : (
          <ul className="list-disc pl-5 text-[11px] space-y-1" style={{ color: "var(--text)" }}>
            {snap.ambiguities.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
        {snap?.llmNotes ? (
          <p className="text-[10px] mt-3 border-t pt-2" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
            Model notes: {snap.llmNotes}
          </p>
        ) : null}
        {snap?.generatedAtIso ? (
          <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
            Snapshot generated {new Date(snap.generatedAtIso).toLocaleString()}
          </p>
        ) : null}
      </Card>

      <Card title="7. AI Analysis of Subsidiaries">
        {subsidiaryListError ? (
          <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
            AI subsidiary analysis failed (matrices may have saved): {subsidiaryListError}
          </p>
        ) : null}
        {running && runPhase === "subsidiary-list" ? (
          <p className="text-sm mb-2" style={{ color: "var(--muted)" }}>
            Generating AI subsidiary analysis…
          </p>
        ) : null}
        {!subsidiaryListMarkdown.trim() && !(running && runPhase === "subsidiary-list") ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No analysis yet. Run Entity Mapper to generate; saved analysis reloads on refresh.
          </p>
        ) : subsidiaryListMarkdown.trim() ? (
          <div
            className="rounded border px-3 py-3 text-sm leading-relaxed overflow-x-auto max-h-[min(70vh,720px)] overflow-y-auto"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            <SavedRichText content={subsidiaryListMarkdown} ticker={safeTicker} />
          </div>
        ) : null}
      </Card>

      {cellModal ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-w-lg w-full max-h-[min(80vh,520px)] overflow-y-auto rounded-lg border p-4 shadow-xl text-[11px]"
            style={{ borderColor: "var(--border2)", background: "var(--card)", color: "var(--text)" }}
          >
            <div className="flex justify-between items-start gap-2 mb-2">
              <div>
                <div className="font-semibold text-xs">{cellModal.familyLabel}</div>
                <div style={{ color: "var(--muted2)" }}>
                  {cellModal.subsidiary} · {cellModal.role}
                </div>
              </div>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border"
                style={{ borderColor: "var(--border2)" }}
                onClick={() => setCellModal(null)}
              >
                Close
              </button>
            </div>
            <div className="mb-2 text-lg">{cellGlyph(cellModal.cell)}</div>
            {!cellModal.cell.evidence_ids.length ? (
              <p style={{ color: "var(--muted)" }}>No evidence IDs attached for this cell.</p>
            ) : (
              <ul className="space-y-3">
                {cellModal.cell.evidence_ids.map((id) => {
                  const ev = evidenceMap.get(id);
                  if (!ev) {
                    return (
                      <li key={id} style={{ color: "var(--warn)" }}>
                        Missing evidence record: {id}
                      </li>
                    );
                  }
                  return (
                    <li key={id} className="rounded border p-2 space-y-1" style={{ borderColor: "var(--border2)" }}>
                      <div>
                        <strong>{ev.role}</strong> · {ev.role_value} · {ev.confidence} · {ev.status}
                      </div>
                      <div style={{ color: "var(--muted2)" }}>
                        {ev.document_name} ({ev.document_type}) · filed {ev.filing_date} · {ev.section_reference}
                      </div>
                      {ev.direct_exhibit_url ? (
                        <a
                          href={ev.direct_exhibit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline block"
                          style={{ color: "var(--accent)" }}
                        >
                          Direct exhibit link
                        </a>
                      ) : null}
                      <blockquote className="text-[10px] pl-2 border-l whitespace-pre-wrap" style={{ borderColor: "var(--border2)" }}>
                        {ev.source_quote || "—"}
                      </blockquote>
                      {ev.notes ? <div className="text-[10px] opacity-90">{ev.notes}</div> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
