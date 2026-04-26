"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { AiProviderChipRow } from "@/components/credit-memo/AiProviderChipRow";
import { ProviderPublicLimitsSidePanel } from "@/components/credit-memo/ProviderPublicLimitsSidePanel";
import { SourceInventoryPanel } from "@/components/credit-memo/SourceInventoryPanel";
import { MemoDeckRunGuidePanel, type MemoDeckRunGuideState } from "@/components/credit-memo/MemoDeckRunGuidePanel";
import { SavedRichText } from "@/components/SavedRichText";
import { type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { shortModelDisplayName } from "@/lib/ai-model-options";
import {
  modelOverridePayloadForProvider,
  resolvedUserModelIdForProvider,
} from "@/lib/ai-model-prefs-client";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import type { CreditMemoVoiceId } from "@/data/credit-memo-voices";
import {
  type CreditMemoClientDraft,
  fetchCreditMemoProjectClient,
  parseCreditMemoDraftJson,
  serializeCreditMemoDraftForPreferences,
} from "@/lib/creditMemo/clientDraftStorage";
import type { MemoDeckLibraryEntry } from "@/lib/ai-memo-deck-library";
import { fetchSavedFromServer } from "@/lib/saved-data-client";
import type {
  CreditMemoProject,
  CreditMemoTemplate,
  CreditMemoTemplateIndex,
  FolderResolveResult,
  MemoOutline,
} from "@/lib/creditMemo/types";
/** Readable value + placeholder contrast on dark UI. */
const MEMO_FIELD_CLASS =
  "w-full rounded border px-2 py-1 border-[var(--border2)] bg-[var(--card2)] text-[var(--text)] caret-[var(--accent)] shadow-sm [&::placeholder]:text-[var(--muted2)]";

const MEMO_ACTION_BTN =
  "rounded border px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[2.75rem] inline-flex items-center justify-center shrink-0";

type SavedMemoVariantId =
  | "latest"
  | "shakespeare"
  | "buffett"
  | "munger"
  | "lynch"
  | "soros"
  | "kafka"
  | "nietzsche";

type SavedMemoVariant = {
  id: SavedMemoVariantId;
  label: string;
  voice: CreditMemoVoiceId | null;
  memoKey: string;
  metaKey: string;
  sourcePackKey: string;
};

type MemoWorkspacePanel = "folder" | "template";

/** Draft JSON may still use legacy `"sources"` or removed `"outline"` panel, or `memo` / `export` from older UI. */
function normalizeDraftPanelToWorkspace(
  _markdown: string | null | undefined,
  saved: CreditMemoClientDraft["panel"]
): MemoWorkspacePanel {
  if (saved === "template") return "template";
  return "folder";
}

const SAVED_MEMO_VARIANTS: readonly SavedMemoVariant[] = [
  {
    id: "latest",
    label: "Credit Memo (Latest)",
    voice: null,
    memoKey: "ai-credit-memo-latest",
    metaKey: "ai-credit-memo-latest-meta",
    sourcePackKey: "ai-credit-memo-latest-source-pack",
  },
  {
    id: "shakespeare",
    label: "Memo - Shakespeare",
    voice: "shakespeare",
    memoKey: "ai-credit-memo-shakespeare",
    metaKey: "ai-credit-memo-shakespeare-meta",
    sourcePackKey: "ai-credit-memo-shakespeare-source-pack",
  },
  {
    id: "buffett",
    label: "Memo - Buffett",
    voice: "buffett",
    memoKey: "ai-credit-memo-buffett",
    metaKey: "ai-credit-memo-buffett-meta",
    sourcePackKey: "ai-credit-memo-buffett-source-pack",
  },
  {
    id: "munger",
    label: "Memo - Munger",
    voice: "munger",
    memoKey: "ai-credit-memo-munger",
    metaKey: "ai-credit-memo-munger-meta",
    sourcePackKey: "ai-credit-memo-munger-source-pack",
  },
  {
    id: "lynch",
    label: "Memo - Lynch",
    voice: "lynch",
    memoKey: "ai-credit-memo-lynch",
    metaKey: "ai-credit-memo-lynch-meta",
    sourcePackKey: "ai-credit-memo-lynch-source-pack",
  },
  {
    id: "soros",
    label: "Memo - Soros",
    voice: "soros",
    memoKey: "ai-credit-memo-soros",
    metaKey: "ai-credit-memo-soros-meta",
    sourcePackKey: "ai-credit-memo-soros-source-pack",
  },
  {
    id: "kafka",
    label: "Memo - Kafka",
    voice: "kafka",
    memoKey: "ai-credit-memo-kafka",
    metaKey: "ai-credit-memo-kafka-meta",
    sourcePackKey: "ai-credit-memo-kafka-source-pack",
  },
  {
    id: "nietzsche",
    label: "Memo - Nietzsche",
    voice: "nietzsche",
    memoKey: "ai-credit-memo-nietzsche",
    metaKey: "ai-credit-memo-nietzsche-meta",
    sourcePackKey: "ai-credit-memo-nietzsche-source-pack",
  },
] as const;

function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function variantLabelForLibrary(voice: CreditMemoVoiceId | null | undefined): string {
  if (!voice) return "latest";
  return voice;
}

function libraryEntryDetailText(row: MemoDeckLibraryEntry): string {
  if (row.kind === "memo") {
    const bits: string[] = [];
    if (row.variant) bits.push(`Variant: ${row.variant}`);
    const prov = row.provider;
    const canPreset =
      prov === "claude" || prov === "openai" || prov === "gemini" || prov === "deepseek";
    if (row.llmModel && canPreset) {
      const short = shortModelDisplayName(prov, row.llmModel);
      bits.push(short === row.llmModel ? `Model: ${short}` : `Model: ${short} (${row.llmModel})`);
    } else if (row.llmModel) {
      bits.push(`Model: ${row.llmModel}`);
    } else if (row.provider) {
      bits.push(`Model not stored — provider was ${row.provider} (re-run memo & library save to record exact model)`);
    }
    return bits.join(" · ") || "—";
  }
  const prov = row.provider;
  const canPreset = prov === "claude" || prov === "openai" || prov === "gemini" || prov === "deepseek";
  if (row.llmModel && canPreset) {
    const short = shortModelDisplayName(prov, row.llmModel);
    return short === row.llmModel
      ? `PowerPoint · ${short}`
      : `PowerPoint · ${short} (${row.llmModel})`;
  }
  if (row.llmModel) return `PowerPoint · ${row.llmModel}`;
  if (row.provider) return `PowerPoint · model not stored (${row.provider})`;
  return "PowerPoint";
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2 py-1 text-[11px] font-medium ${active ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border2)] text-[var(--muted2)]"} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export function CompanyAiCreditMemoTab({ ticker, companyName }: { ticker: string; companyName?: string }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;
  const defaultTitle = `${companyName ? `${companyName} (${tk})` : tk} — Credit Memo`;

  const [panel, setPanel] = useState<MemoWorkspacePanel>("folder");

  const [targetWords, setTargetWords] = useState(10_000);
  const [memoTitle, setMemoTitle] = useState(defaultTitle);
  const [provider, setProvider] = useState<AiProvider>("claude");
  const [useTemplate, setUseTemplate] = useState(true);
  const [templateIndex, setTemplateIndex] = useState<CreditMemoTemplateIndex | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolved, setResolved] = useState<FolderResolveResult | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [project, setProject] = useState<CreditMemoProject | null>(null);

  /** Which memo action is in flight: default button vs a character voice (so loading text shows on the right control). */
  const [memoGenPhase, setMemoGenPhase] = useState<null | "default" | CreditMemoVoiceId>(null);
  const memoGenBusy = memoGenPhase !== null;
  const [genError, setGenError] = useState<string | null>(null);
  const [lastRunGuide, setLastRunGuide] = useState<MemoDeckRunGuideState | null>(null);
  const [deckGenLoading, setDeckGenLoading] = useState(false);
  const [deckGenError, setDeckGenError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outline, setOutline] = useState<MemoOutline | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [lastVoice, setLastVoice] = useState<CreditMemoVoiceId | null>(null);
  const [libraryEntries, setLibraryEntries] = useState<MemoDeckLibraryEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryBusyId, setLibraryBusyId] = useState<string | null>(null);
  /** Library deck row opened via View (download lives on the Deck preview card). */
  const [libraryDeckId, setLibraryDeckId] = useState<string | null>(null);
  const [saveToLibraryBusy, setSaveToLibraryBusy] = useState(false);
  /** Word / MD / HTML download from current preview (not stale job links). */
  const [screenExportBusy, setScreenExportBusy] = useState<null | "docx" | "md" | "html">(null);
  const [screenExportError, setScreenExportError] = useState<string | null>(null);

  /** After session draft hydrate; avoids overwriting storage before load runs. */
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    if (!prefsReady) return;
    const n = normalizeAiProvider(preferences.aiProvider);
    if (n) setProvider(n);
  }, [prefsReady, preferences.aiProvider]);

  const persistProvider = useCallback(
    (p: AiProvider) => {
      setProvider(p);
      updatePreferences((prev) => ({ ...prev, aiProvider: p }));
    },
    [updatePreferences]
  );

  /** Restore draft from user preferences, then server-saved latest memo. */
  useEffect(() => {
    setDraftReady(false);
    setLibraryDeckId(null);
    if (!tk) {
      setDraftReady(true);
      return;
    }
    if (!prefsReady) return;

    const raw = prefsRef.current.creditMemoDrafts?.[tk];
    const d = raw ? parseCreditMemoDraftJson(raw, tk) : null;
    if (d) {
      setProject(d.project);
      setMarkdown(d.markdown);
      setJobId(d.jobId);
      setOutline(d.outline);
      setMemoTitle(d.memoTitle.trim() || defaultTitle);
      setTargetWords(d.targetWords);
      setUseTemplate(d.useTemplate);
      setPanel(normalizeDraftPanelToWorkspace(d.markdown, d.panel));
      setDraftReady(true);
      if (d.project?.id) {
        void fetchCreditMemoProjectClient(d.project.id).then((p) => {
          if (p) setProject(p);
        });
      }
      return;
    }

    void (async () => {
      const [savedMemo, savedMeta] = await Promise.all([
        fetchSavedFromServer(tk, "ai-credit-memo-latest"),
        fetchSavedFromServer(tk, "ai-credit-memo-latest-meta"),
      ]);
      if (savedMemo && savedMemo.trim()) {
        setMarkdown(savedMemo);
        setPanel("folder");
        if (savedMeta && savedMeta.trim()) {
          try {
            const meta = JSON.parse(savedMeta) as { jobId?: string; memoTitle?: string; targetWords?: number; useTemplate?: boolean };
            if (typeof meta.jobId === "string") setJobId(meta.jobId);
            if (typeof meta.memoTitle === "string" && meta.memoTitle.trim()) setMemoTitle(meta.memoTitle.trim());
            if (typeof meta.targetWords === "number" && Number.isFinite(meta.targetWords)) setTargetWords(meta.targetWords);
            if (typeof meta.useTemplate === "boolean") setUseTemplate(meta.useTemplate);
          } catch {
            /* ignore */
          }
        }
        setProject(null);
        setOutline(null);
        setResolved(null);
        setLastRunGuide(null);
        setDraftReady(true);
        return;
      }

        setProject(null);
        setMarkdown(null);
        setLastRunGuide(null);
        setJobId(null);
      setOutline(null);
      setMemoTitle(defaultTitle);
      setTargetWords(10_000);
      setUseTemplate(true);
      setPanel("folder");
      setResolved(null);
      setDraftReady(true);
    })();
  }, [tk, prefsReady, defaultTitle]);

  const loadLibrary = useCallback(async () => {
    if (!tk) return;
    setLibraryError(null);
    try {
      const res = await fetch(`/api/credit-memo/library/${encodeURIComponent(tk)}`);
      const j = (await res.json()) as { entries?: MemoDeckLibraryEntry[]; error?: string };
      if (!res.ok) throw new Error(j.error || "Library load failed");
      setLibraryEntries(Array.isArray(j.entries) ? j.entries : []);
    } catch (e) {
      setLibraryEntries([]);
      setLibraryError(e instanceof Error ? e.message : "Library load failed");
    }
  }, [tk]);

  useEffect(() => {
    if (!tk) {
      setLibraryEntries([]);
      setLibraryError(null);
      setLibraryLoading(false);
      return;
    }
    setLibraryLoading(true);
    void loadLibrary().finally(() => setLibraryLoading(false));
  }, [tk, loadLibrary]);

  const pushMemoToLibrary = useCallback(
    async (markdownText: string, voice: CreditMemoVoiceId | null, llmModelUsed?: string | null) => {
      if (!tk || !markdownText.trim()) return;
      const llmModel =
        (typeof llmModelUsed === "string" && llmModelUsed.trim() ? llmModelUsed.trim() : null) ??
        resolvedUserModelIdForProvider(provider) ??
        null;
      try {
        const res = await fetch(`/api/credit-memo/library/${encodeURIComponent(tk)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "addMemo",
            title: memoTitle.trim() || defaultTitle,
            markdown: markdownText,
            variant: variantLabelForLibrary(voice),
            provider,
            llmModel,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "Save to library failed");
        }
        await loadLibrary();
      } catch {
        /* best-effort archive; generation already succeeded */
      }
    },
    [tk, memoTitle, defaultTitle, provider, loadLibrary]
  );

  const downloadMemoOnScreen = useCallback(
    async (format: "docx" | "md" | "html") => {
      if (!markdown?.trim()) return;
      setScreenExportError(null);
      setScreenExportBusy(format);
      try {
        const res = await fetch("/api/credit-memo/memo/export-from-body", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format,
            markdown,
            memoTitle: memoTitle.trim() || defaultTitle,
            ticker: tk,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Export failed (${res.status})`);
        }
        const cd = res.headers.get("Content-Disposition") ?? "";
        const m = /filename="([^"]+)"/i.exec(cd);
        const filename =
          m?.[1] ?? (format === "docx" ? "credit-memo.docx" : format === "html" ? "credit-memo.html" : "credit-memo.md");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        setScreenExportError(e instanceof Error ? e.message : "Download failed");
      } finally {
        setScreenExportBusy(null);
      }
    },
    [markdown, memoTitle, defaultTitle, tk]
  );

  const pushDeckToLibrary = useCallback(
    async (
      blob: Blob,
      deckTitle: string,
      meta?: { provider?: string; llmModel?: string }
    ) => {
      if (!tk) return;
      try {
        const fd = new FormData();
        fd.set("action", "addDeck");
        fd.set("title", deckTitle);
        if (meta?.provider) fd.set("provider", meta.provider);
        if (meta?.llmModel) fd.set("llmModel", meta.llmModel);
        fd.set("file", blob, `${tk}-credit-deck.pptx`);
        const res = await fetch(`/api/credit-memo/library/${encodeURIComponent(tk)}`, { method: "POST", body: fd });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "Deck library save failed");
        }
        await loadLibrary();
      } catch {
        /* best-effort */
      }
    },
    [tk, loadLibrary]
  );

  /** Persist draft to server-backed preferences when switching tickers or editing. */
  useEffect(() => {
    if (!tk || !draftReady) return;
    if (!project) {
      updatePreferences((p) => {
        const cd = { ...(p.creditMemoDrafts ?? {}) };
        delete cd[tk];
        return { ...p, creditMemoDrafts: Object.keys(cd).length ? cd : undefined };
      });
      return;
    }
    updatePreferences((p) => ({
      ...p,
      creditMemoDrafts: {
        ...(p.creditMemoDrafts ?? {}),
        [tk]: serializeCreditMemoDraftForPreferences({
          project,
          jobId,
          outline,
          markdown,
          memoTitle,
          targetWords,
          useTemplate,
          panel: panel,
        }),
      },
    }));
  }, [tk, draftReady, project, jobId, outline, markdown, memoTitle, targetWords, useTemplate, panel, updatePreferences]);

  const refreshTemplate = useCallback(async () => {
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const res = await fetch("/api/credit-memo/template");
      const json = (await res.json()) as { index: CreditMemoTemplateIndex | null; error?: string };
      if (!res.ok) throw new Error(json.error || "Template fetch failed");
      setTemplateIndex(json.index ?? { activeTemplateId: null, templates: [] });
    } catch (e) {
      setTemplateIndex(null);
      setTemplateError(e instanceof Error ? e.message : "Template fetch failed");
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTemplate();
  }, [refreshTemplate]);

  const runResolve = useCallback(async () => {
    if (!tk) return;
    setResolveLoading(true);
    setResolved(null);
    setProject(null);
    setMarkdown(null);
    setOutline(null);
    setJobId(null);
    let success: FolderResolveResult | null = null;
    try {
      const res = await fetch("/api/credit-memo/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk }),
      });
      const text = await res.text();
      let data: FolderResolveResult | { error?: string };
      try {
        data = JSON.parse(text) as FolderResolveResult | { error?: string };
      } catch {
        throw new Error(
          text.trim()
            ? `Server returned invalid JSON (${res.status}): ${text.slice(0, 200)}`
            : `Empty response from server (${res.status}). Check the server console for errors.`
        );
      }
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

  const runIngestRef = useRef<
    (pathOverride: string, resolutionMeta: FolderResolveResult | null) => Promise<void>
  >(() => Promise.resolve());
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
            workProductIngestScope: "memo",
          }),
        });
        const rawText = await res.text();
        let data: {
          ok?: boolean;
          project?: CreditMemoProject;
          error?: string;
          ingestWarnings?: string[];
        };
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(
            rawText.trim()
              ? `Server returned invalid JSON (${res.status}): ${rawText.slice(0, 200)}`
              : `Empty response from server (${res.status}). Check the server console for errors.`
          );
        }
        if (!res.ok) throw new Error(data.error || "Ingest failed");
        const nextProject = data.project!;
        const prevId = project?.id;
        setProject(nextProject);
        if (prevId && nextProject.id !== prevId) {
          setMarkdown(null);
          setOutline(null);
          setJobId(null);
        }
      } catch (e) {
        setIngestError(e instanceof Error ? e.message : "Ingest failed");
      } finally {
        setIngestLoading(false);
      }
    },
    [tk, resolved, project?.id]
  );

  runIngestRef.current = (folderPath, resolutionMeta) => runIngest(folderPath, resolutionMeta);

  /**
   * Signed-in: one automatic scan when there is no ingested project and no prior resolve result
   * (avoids looping with manual Refresh, which sets resolveLoading).
   */
  useEffect(() => {
    if (!tk || !draftReady || authStatus !== "authenticated") return;
    if (project) return;
    if (resolved !== null) return;
    if (resolveLoading || ingestLoading) return;
    void runResolve();
  }, [tk, draftReady, authStatus, project, resolved, resolveLoading, ingestLoading, runResolve]);

  const runGenerate = useCallback(async (voice?: CreditMemoVoiceId) => {
    if (!project) {
      setGenError("Run Refresh Source, Ingest & Index first.");
      return;
    }
    setMemoGenPhase(voice ?? "default");
    setGenError(null);
    try {
      const res = await fetch(`/api/credit-memo/project/${encodeURIComponent(project.id)}/memo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetWords,
          memoTitle: memoTitle.trim() || defaultTitle,
          provider,
          useTemplate,
          voice: voice ?? null,
          ...modelOverridePayloadForProvider(provider),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        jobId?: string;
        outline?: MemoOutline;
        markdown?: string;
        llmModelUsed?: string;
        error?: string;
        sentSystemMessage?: string;
        sentUserMessage?: string;
        userMessageBreakdown?: {
          taskSpecChars: number;
          bridgeChars: number;
          formattedSourcesChars: number;
          totalUserMessageChars: number;
        };
        evidenceDiagnostics?: MemoDeckRunGuideState["evidenceDiagnostics"];
      };
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setJobId(data.jobId ?? null);
      setOutline(data.outline ?? null);
      setMarkdown(data.markdown ?? null);
      setLastVoice(voice ?? null);

      if (
        typeof data.sentSystemMessage === "string" &&
        typeof data.sentUserMessage === "string" &&
        data.userMessageBreakdown &&
        data.evidenceDiagnostics
      ) {
        setLastRunGuide({
          kind: "memo",
          sentSystemMessage: data.sentSystemMessage,
          sentUserMessage: data.sentUserMessage,
          userBreakdown: data.userMessageBreakdown,
          evidenceDiagnostics: data.evidenceDiagnostics,
          systemChars: data.sentSystemMessage.length,
        });
      } else {
        setLastRunGuide(null);
      }

      if (data.markdown && data.markdown.trim()) {
        void pushMemoToLibrary(data.markdown, voice ?? null, data.llmModelUsed ?? null);
      }
      const np = await fetchCreditMemoProjectClient(project.id);
      if (np) setProject(np);
    } catch (e) {
      if (e instanceof Error) {
        const msg = e.message || "Generation failed";
        if (msg.toLowerCase().includes("fetch failed") || msg.toLowerCase().includes("failed to fetch")) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          setGenError(
            `Server unreachable (network error). Make sure \`npm run dev\` is running and you're on the correct port${origin ? ` (${origin})` : ""}.`
          );
          return;
        }
        setGenError(msg);
      } else {
        setGenError("Generation failed");
      }
    } finally {
      setMemoGenPhase(null);
    }
  }, [project, targetWords, memoTitle, defaultTitle, provider, useTemplate, pushMemoToLibrary]);

  const runGenerateDeck = useCallback(async () => {
    if (!project) {
      setDeckGenError("Run Refresh Source, Ingest & Index first.");
      return;
    }
    setDeckGenLoading(true);
    setDeckGenError(null);
    try {
      const titleBase = memoTitle.trim() || defaultTitle;
      const deckTitle = titleBase.replace(/\bCredit Memo\b/gi, "Credit Deck");
      const res = await fetch("/api/credit-deck/from-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          targetWords,
          deckTitle,
          memoTitle: titleBase,
          provider,
          useTemplate,
          ...modelOverridePayloadForProvider(provider),
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const errJson = (await res.json()) as { error?: string };
          if (typeof errJson.error === "string" && errJson.error.trim()) msg = errJson.error.trim();
        } catch {
          /* use msg */
        }
        throw new Error(msg);
      }
      const telB64 = res.headers.get("X-Ceg-Deck-Run-Telemetry");
      if (telB64) {
        try {
          const j = JSON.parse(atob(telB64)) as {
            evidenceDiagnostics: MemoDeckRunGuideState["evidenceDiagnostics"];
            userMessageBreakdown: {
              taskSpecChars: number;
              bridgeChars: number;
              formattedSourcesChars: number;
              totalUserMessageChars: number;
            };
            systemMessageChars: number;
            userMessageChars: number;
          };
          setLastRunGuide({
            kind: "deck",
            evidenceDiagnostics: j.evidenceDiagnostics,
            userBreakdown: j.userMessageBreakdown,
            systemChars: j.systemMessageChars,
            userMessageCharsOnly: j.userMessageChars,
          });
        } catch {
          /* ignore parse errors */
        }
      }
      const npDeck = await fetchCreditMemoProjectClient(project.id);
      if (npDeck) setProject(npDeck);

      const hdrModel = res.headers.get("X-Ceg-Llm-Model-Id")?.trim() || "";
      const hdrProv = res.headers.get("X-Ceg-Llm-Provider")?.trim() || "";
      const blob = await res.blob();
      void pushDeckToLibrary(blob, deckTitle, {
        provider: hdrProv || provider,
        llmModel: hdrModel || resolvedUserModelIdForProvider(provider) || "",
      });
      const cd = res.headers.get("Content-Disposition");
      let filename = `${tk}-credit-deck-draft.pptx`;
      if (cd) {
        const mStar = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
        if (mStar) {
          try {
            filename = decodeURIComponent(mStar[1].replace(/"/g, "").trim());
          } catch {
            /* keep default */
          }
        } else {
          const mQ = /filename="([^"]+)"/i.exec(cd);
          const mPlain = /filename=([^;\s]+)/i.exec(cd);
          const raw = mQ?.[1] ?? mPlain?.[1];
          if (raw) filename = raw.replace(/^"|"$/g, "").trim();
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof Error) {
        const msg = e.message || "Deck generation failed";
        if (msg.toLowerCase().includes("fetch failed") || msg.toLowerCase().includes("failed to fetch")) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          setDeckGenError(
            `Server unreachable (network error). Make sure the dev server is running${origin ? ` (${origin})` : ""}.`
          );
          return;
        }
        setDeckGenError(msg);
      } else {
        setDeckGenError("Deck generation failed");
      }
    } finally {
      setDeckGenLoading(false);
    }
  }, [project, targetWords, memoTitle, defaultTitle, provider, useTemplate, tk, pushDeckToLibrary]);

  if (!tk) {
    return (
      <Card title="AI Memo and Deck">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker to generate a folder-based credit memo or deck.
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const resolveFailed = resolved && !resolved.ok ? { error: resolved.error } : null;
  const refreshingSources = resolveLoading || ingestLoading;

  return (
    <div className="space-y-6">
      <Card title={`AI Memo and Deck — ${tk}`}>
        {refreshingSources && project ? (
          <p className="text-[11px] mb-3 flex items-center gap-2" style={{ color: "var(--muted)" }}>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
            Refreshing sources…
          </p>
        ) : null}

        <div className="flex flex-col xl:flex-row xl:gap-6 xl:items-start">
          <div className="min-w-0 flex-1 space-y-4">
        <ol className="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          <li>Click on &ldquo;Refresh Source, Ingest &amp; Index&rdquo; to pull in source documents.</li>
          <li>Select AI model.</li>
          <li>
            Click on &ldquo;Generate Credit Memo&rdquo;, &ldquo;Generate Credit Deck&rdquo;, voice memos such as
            &ldquo;Memo - Shakespeare&rdquo;, &ldquo;Memo - Kafka&rdquo;, or &ldquo;Memo - Nietzsche&rdquo;, etc. to generate
            work product.
          </li>
        </ol>

        {needsSignIn && (
          <p className="text-xs rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
            Sign in to resolve your ticker workspace, ingest sources, and generate memos and decks. Saved output is stored per account.
          </p>
        )}

        <AiProviderChipRow aiProvider={provider} onProviderChange={persistProvider} />

        <div className="flex flex-wrap gap-2">
          <TabButton active={panel === "folder"} onClick={() => setPanel("folder")}>
            Sources
          </TabButton>
          <TabButton active={panel === "template"} onClick={() => setPanel("template")}>
            Template
          </TabButton>
        </div>

        {panel === "folder" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={resolveLoading || ingestLoading || needsSignIn}
                onClick={() => void runResolve()}
                className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              >
                {resolveLoading ? "Scanning…" : ingestLoading ? "Ingesting…" : "Refresh Source, Ingest & Index"}
              </button>
            </div>

            <SourceInventoryPanel
              project={project}
              resolveFailed={resolveFailed}
              ingestError={ingestError}
              needsSignIn={needsSignIn}
              listMaxHeightClass="max-h-[50vh]"
              emptyHint={
                <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
                  No indexed files yet. Click <strong>Refresh Source, Ingest &amp; Index</strong> after signing in, or wait for the automatic
                  resolve on first load.
                </p>
              }
            />
          </div>
        )}

        {panel === "template" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
                <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
                Use uploaded DOCX template outline for memo sections (recommended)
              </label>
              <button
                type="button"
                onClick={() => void refreshTemplate()}
                className="rounded border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
              >
                Refresh
              </button>
            </div>

            {templateError ? (
              <div className="rounded border border-dashed p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
                {templateError}
              </div>
            ) : null}

            <div className="rounded border p-3" style={{ borderColor: "var(--border2)" }}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Available templates
              </div>
              <p className="mb-2 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                Click a file name to download the .docx. The row marked <strong style={{ color: "var(--accent)" }}>In use</strong> is the
                outline the model follows (use <strong>Use</strong> to switch when you have several). A{" "}
                <strong>shared default</strong> may appear for new accounts until you upload your own.
              </p>
              {templateLoading ? (
                <p className="text-xs" style={{ color: "var(--muted2)" }}>Loading…</p>
              ) : templateIndex && templateIndex.templates.length > 0 ? (
                <>
                  <TemplateList
                    index={templateIndex}
                    onSelect={async (id) => {
                      const res = await fetch("/api/credit-memo/template?action=select", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ templateId: id }),
                      });
                      const json = (await res.json()) as { ok?: boolean; index?: CreditMemoTemplateIndex; error?: string };
                      if (!res.ok) throw new Error(json.error || "Select failed");
                      setTemplateIndex(json.index ?? templateIndex);
                      setUseTemplate(true);
                    }}
                    onDelete={async (id) => {
                      const res = await fetch("/api/credit-memo/template?action=delete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ templateId: id }),
                      });
                      const json = (await res.json()) as { ok?: boolean; index?: CreditMemoTemplateIndex; error?: string };
                      if (!res.ok) throw new Error(json.error || "Delete failed");
                      setTemplateIndex(json.index ?? templateIndex);
                    }}
                  />
                </>
              ) : (
                <p className="text-xs" style={{ color: "var(--muted2)" }}>
                  No memo template is available yet. Upload a DOCX to control the memo outline, or ask your admin to add the shared default
                  file on the server.
                </p>
              )}
            </div>

            <div className="rounded border p-3" style={{ borderColor: "var(--border2)" }}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Upload / replace template (.docx)
              </div>
              <TemplateUploader
                onUploaded={(payload) => {
                  setTemplateIndex(payload.index ?? templateIndex);
                  setUseTemplate(true);
                }}
              />
              <p className="mt-2 text-[10px]" style={{ color: "var(--muted)" }}>
                Tip: apply Word heading styles (Heading 1/2/3). They become the outline order.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
              Target words
            </div>
            <input
              type="number"
              min={2500}
              max={120000}
              step={500}
              value={targetWords}
              onChange={(e) => setTargetWords(Number(e.target.value) || 10_000)}
              className={MEMO_FIELD_CLASS}
            />
            <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
              Total memo scale (~2.5k–120k). Section budgets are allocated from this total.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
            <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
            Use uploaded DOCX template outline for memo sections (if configured)
          </label>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
              Memo title
            </div>
            <input
              value={memoTitle}
              onChange={(e) => setMemoTitle(e.target.value)}
              className={MEMO_FIELD_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-3">
          <button
            type="button"
            disabled={memoGenBusy || deckGenLoading || !project || needsSignIn}
            onClick={() => void runGenerate()}
            className={MEMO_ACTION_BTN}
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {memoGenPhase === "default"
              ? "Generating memo (may take several minutes)…"
              : "Generate credit memo"}
          </button>
          <button
            type="button"
            disabled={memoGenBusy || deckGenLoading || !project || needsSignIn}
            onClick={() => void runGenerateDeck()}
            className={MEMO_ACTION_BTN}
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {deckGenLoading ? "Generating deck (may take a few minutes)…" : "Generate credit Deck"}
          </button>
          {(SAVED_MEMO_VARIANTS.filter((v) => v.voice) as SavedMemoVariant[]).map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={memoGenBusy || deckGenLoading || !project || needsSignIn}
              onClick={() => void runGenerate(v.voice!)}
              className={MEMO_ACTION_BTN}
              style={{
                borderColor: "var(--accent)",
                color: "var(--accent)",
                background: lastVoice === v.voice ? "rgba(0,212,170,0.14)" : "transparent",
              }}
              title="Generate memo in this voice"
            >
              {memoGenPhase === v.voice
                ? "Generating memo (may take several minutes)…"
                : v.label}
            </button>
          ))}
        </div>
        {genError ? <p className="text-sm" style={{ color: "var(--danger)" }}>{genError}</p> : null}
        {deckGenError ? <p className="text-sm" style={{ color: "var(--danger)" }}>{deckGenError}</p> : null}
          </div>

          <ProviderPublicLimitsSidePanel
            provider={provider}
            resolvedModelId={resolvedUserModelIdForProvider(provider)}
            className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[min(100%,320px)]"
          />
        </div>
      </Card>

      <MemoDeckRunGuidePanel run={lastRunGuide} />

      <Card title="Memo & deck library">
        <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Successful <strong>Generate credit memo</strong> and <strong>Generate credit Deck</strong> runs are archived here automatically
          in your <strong>account</strong> (Postgres). Use <strong>Delete</strong> to remove an item. Use{" "}
          <strong>Save current memo to library</strong> to add another copy of what is on screen.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!tk}
            onClick={() => void loadLibrary()}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
          >
            Refresh list
          </button>
          <button
            type="button"
            disabled={saveToLibraryBusy || !markdown?.trim()}
            onClick={() => {
              if (!markdown?.trim()) return;
              setSaveToLibraryBusy(true);
              setLibraryError(null);
              void (async () => {
                try {
                  const res = await fetch(`/api/credit-memo/library/${encodeURIComponent(tk)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "addMemo",
                      title: memoTitle.trim() || defaultTitle,
                      markdown,
                      variant: variantLabelForLibrary(lastVoice),
                      provider,
                      llmModel: resolvedUserModelIdForProvider(provider) ?? null,
                    }),
                  });
                  const j = (await res.json().catch(() => ({}))) as { error?: string };
                  if (!res.ok) throw new Error(j.error || "Save failed");
                  await loadLibrary();
                } catch (e) {
                  setLibraryError(e instanceof Error ? e.message : "Save to library failed");
                } finally {
                  setSaveToLibraryBusy(false);
                }
              })();
            }}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {saveToLibraryBusy ? "Saving…" : "Save current memo to library (duplicate OK)"}
          </button>
        </div>
        {libraryError ? (
          <p className="mb-2 text-xs" style={{ color: "var(--warn)" }}>
            {libraryError}
          </p>
        ) : null}
        {libraryLoading && libraryEntries.length === 0 ? (
          <p className="text-sm py-2" style={{ color: "var(--muted2)" }}>
            Loading library…
          </p>
        ) : libraryEntries.length === 0 ? (
          <p className="text-sm py-2" style={{ color: "var(--muted2)" }}>
            No library items yet. Generate a memo or deck above.
          </p>
        ) : (
          <div className="max-h-[min(55vh,520px)] overflow-auto rounded border" style={{ borderColor: "var(--border2)" }}>
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 z-[1]" style={{ background: "var(--card)", color: "var(--muted)" }}>
                <tr>
                  <th className="p-2">Type</th>
                  <th className="p-2">Title</th>
                  <th className="p-2">When</th>
                  <th className="p-2">Detail</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {libraryEntries.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--border2)] align-top">
                    <td className="p-2 font-semibold" style={{ color: "var(--text)" }}>
                      {row.kind === "memo" ? "Memo" : "Deck"}
                    </td>
                    <td className="min-w-0 p-2 break-words" style={{ color: "var(--text)" }}>
                      {row.title}
                    </td>
                    <td className="whitespace-nowrap p-2 font-mono" style={{ color: "var(--muted2)" }}>
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="min-w-0 max-w-md p-2 break-words" style={{ color: "var(--muted2)" }}>
                      <span>{libraryEntryDetailText(row)}</span>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap">
                        {row.kind === "memo" ? (
                          <>
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-[10px] font-semibold"
                              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                              onClick={() => {
                                void (async () => {
                                  const res = await fetch(
                                    `/api/credit-memo/library/${encodeURIComponent(tk)}?memoId=${encodeURIComponent(row.id)}`
                                  );
                                  const j = (await res.json()) as { markdown?: string };
                                  if (j.markdown) {
                                    setLibraryDeckId(null);
                                    setJobId(null);
                                    setMarkdown(j.markdown);
                                  }
                                })();
                              }}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-[10px] font-semibold"
                              style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
                              onClick={() => {
                                void (async () => {
                                  const res = await fetch(
                                    `/api/credit-memo/library/${encodeURIComponent(tk)}?memoId=${encodeURIComponent(row.id)}`
                                  );
                                  const j = (await res.json()) as { markdown?: string };
                                  if (j.markdown) {
                                    downloadTextFile(
                                      `${tk}_library_${row.id.slice(0, 8)}.md`,
                                      j.markdown,
                                      "text/markdown; charset=utf-8"
                                    );
                                  }
                                })();
                              }}
                            >
                              .md
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="rounded border px-2 py-1 text-[10px] font-semibold"
                            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                            onClick={() => {
                              setLibraryDeckId(row.id);
                            }}
                          >
                            View
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={libraryBusyId === row.id}
                          className="rounded border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
                          onClick={() => {
                            if (!confirm(`Delete this ${row.kind} from the library?`)) return;
                            setLibraryBusyId(row.id);
                            void (async () => {
                              try {
                                const res = await fetch(
                                  `/api/credit-memo/library/${encodeURIComponent(tk)}?id=${encodeURIComponent(row.id)}`,
                                  { method: "DELETE" }
                                );
                                if (res.ok) {
                                  if (libraryDeckId === row.id) setLibraryDeckId(null);
                                  await loadLibrary();
                                }
                              } finally {
                                setLibraryBusyId(null);
                              }
                            })();
                          }}
                        >
                          {libraryBusyId === row.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {libraryDeckId && (
        <Card title={libraryEntries.find((e) => e.id === libraryDeckId)?.title ?? "Library deck"}>
          <p className="mb-3 text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
            PowerPoint file from your library. Download below to save the .pptx.
          </p>
          <a
            href={`/api/credit-memo/library/${encodeURIComponent(tk)}?deckId=${encodeURIComponent(libraryDeckId)}`}
            className="inline-block rounded border px-4 py-2 text-sm font-medium no-underline"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            download
          >
            Download PowerPoint (.pptx)
          </a>
        </Card>
      )}

      {markdown && (
        <Card title="Memo draft">
          <p className="mb-2 text-sm" style={{ color: "var(--muted2)" }}>
            Preview uses Word-like typography (Times, page width). <strong>Word</strong>, <strong>Markdown</strong>, and{" "}
            <strong>HTML</strong> use the <strong>same memo text</strong> as the preview (including library memos you opened
            with View).{" "}
            {jobId ? (
              <>
                <strong>Source pack</strong> is tied to the last generate job.
              </>
            ) : (
              <>Generate a new memo to attach a source pack from that run.</>
            )}
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!screenExportBusy}
              onClick={() => void downloadMemoOnScreen("docx")}
              className="rounded border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {screenExportBusy === "docx" ? "Preparing Word…" : "Download Word (.docx)"}
            </button>
            <button
              type="button"
              disabled={!!screenExportBusy}
              onClick={() => void downloadMemoOnScreen("md")}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              {screenExportBusy === "md" ? "Preparing…" : "Markdown"}
            </button>
            <button
              type="button"
              disabled={!!screenExportBusy}
              onClick={() => void downloadMemoOnScreen("html")}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              {screenExportBusy === "html" ? "Preparing…" : "HTML"}
            </button>
            {jobId ? (
              <a
                href={`/api/credit-memo/memo/${encodeURIComponent(jobId)}/export?format=source-pack`}
                className="inline-flex items-center rounded border px-3 py-2 text-sm no-underline"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                Source pack (.txt)
              </a>
            ) : null}
          </div>
          {screenExportError ? (
            <p className="mb-2 text-xs" style={{ color: "var(--danger)" }}>
              {screenExportError}
            </p>
          ) : null}
          {jobId ? <p className="mb-2 text-[10px] font-mono" style={{ color: "var(--muted)" }}>Job (source pack): {jobId}</p> : null}
          <div className="credit-memo-word-preview max-h-[min(70vh,900px)] overflow-y-auto">
            <SavedRichText content={markdown} ticker={tk} />
          </div>
        </Card>
      )}
    </div>
  );
}

function TemplateUploader({ onUploaded }: { onUploaded: (payload: { template: CreditMemoTemplate; index: CreditMemoTemplateIndex | null }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setErr(null);
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch("/api/credit-memo/template", { method: "POST", body: fd });
        const json = (await res.json()) as { ok?: boolean; template?: CreditMemoTemplate; index?: CreditMemoTemplateIndex; error?: string };
        if (!res.ok || !json.template) throw new Error(json.error || "Template upload failed");
        onUploaded({ template: json.template, index: json.index ?? null });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Template upload failed");
      } finally {
        setBusy(false);
      }
    },
    [onUploaded]
  );

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept=".docx"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      {err ? (
        <div className="text-xs" style={{ color: "var(--warn)" }}>
          {err}
        </div>
      ) : null}
      {busy ? (
        <div className="text-xs" style={{ color: "var(--muted2)" }}>
          Uploading & parsing template…
        </div>
      ) : null}
    </div>
  );
}

function TemplateList({
  index,
  onSelect,
  onDelete,
}: {
  index: CreditMemoTemplateIndex;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = index.activeTemplateId;

  return (
    <div className="max-h-52 overflow-auto rounded border" style={{ borderColor: "var(--border2)" }}>
      <table className="w-full text-left text-[11px]">
        <thead style={{ color: "var(--muted)" }}>
          <tr>
            <th className="p-2">Template</th>
            <th className="p-2">Uploaded</th>
            <th className="p-2 w-[1%] whitespace-nowrap text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {index.templates.map((t) => {
            const isActive = t.id === active;
            return (
              <tr
                key={t.id}
                className="border-t border-[var(--border)]"
                style={isActive ? { background: "rgba(0, 212, 170, 0.06)" } : undefined}
              >
                <td className="p-2 align-top">
                  <div className="flex flex-col gap-0.5">
                    <a
                      href={`/api/credit-memo/template?templateId=${encodeURIComponent(t.id)}&download=1`}
                      className="font-medium underline underline-offset-2 hover:opacity-90"
                      style={{ color: "var(--accent)" }}
                      download={t.filename}
                    >
                      {t.filename}
                    </a>
                    {t.isPublicDefault ? (
                      <span className="text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
                        Shared default
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="p-2 align-top font-mono" style={{ color: "var(--muted2)" }}>
                  {t.uploadedAt}
                </td>
                <td className="p-2 align-middle">
                  <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
                    {isActive ? (
                      <span
                        className="inline-flex rounded border px-2 py-1 text-[10px] font-semibold"
                        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                        title="This template drives memo outline for generation"
                      >
                        In use
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-semibold transition-colors hover:opacity-90"
                        style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                        disabled={busyId === t.id}
                        onClick={() => {
                          setBusyId(t.id);
                          void onSelect(t.id).finally(() => setBusyId(null));
                        }}
                      >
                        {busyId === t.id ? "…" : "Use"}
                      </button>
                    )}
                    {t.isPublicDefault ? (
                      <span className="text-[10px]" style={{ color: "var(--muted2)" }} title="Cannot delete the shared default">
                        —
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-semibold"
                        style={{ borderColor: "var(--warn)", color: "var(--warn)", background: "transparent" }}
                        disabled={busyId === t.id}
                        onClick={() => {
                          if (!confirm(`Delete template ${t.filename}?`)) return;
                          setBusyId(t.id);
                          void onDelete(t.id).finally(() => setBusyId(null));
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
