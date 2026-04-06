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
import type { CreditMemoVoiceId } from "@/data/credit-memo-voices";
import {
  parseCreditMemoDraftJson,
  serializeCreditMemoDraft,
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

/** Primary, deck, and voice generators: same width; stretch to row height on wrap. */
const MEMO_GENERATE_BTN_CLASS =
  "inline-flex min-h-[3.5rem] w-[17.5rem] shrink-0 items-center justify-center rounded border px-3 py-2 text-center text-sm font-semibold leading-snug disabled:opacity-50";

type SavedMemoVariantId =
  | "latest"
  | "shakespeare"
  | "buffett"
  | "munger"
  | "lynch"
  | "soros";

type SavedMemoVariant = {
  id: SavedMemoVariantId;
  label: string;
  voice: CreditMemoVoiceId | null;
  memoKey: string;
  metaKey: string;
  sourcePackKey: string;
};

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
] as const;

type SavedMemoLoaded = {
  markdown: string;
  meta: { createdAt?: string; memoTitle?: string; targetWords?: number; provider?: string; jobId?: string } | null;
};

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

  const [panel, setPanel] = useState<"folder" | "template" | "outline" | "memo" | "export">("folder");

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

  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [deckGenLoading, setDeckGenLoading] = useState(false);
  const [deckGenError, setDeckGenError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outline, setOutline] = useState<MemoOutline | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [lastVoice, setLastVoice] = useState<CreditMemoVoiceId | null>(null);
  const [savedMemos, setSavedMemos] = useState<Partial<Record<SavedMemoVariantId, SavedMemoLoaded>>>({});
  const [savedMemosLoading, setSavedMemosLoading] = useState(false);

  const [libraryEntries, setLibraryEntries] = useState<MemoDeckLibraryEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryBusyId, setLibraryBusyId] = useState<string | null>(null);
  const [saveToLibraryBusy, setSaveToLibraryBusy] = useState(false);

  /** After session draft hydrate; avoids overwriting storage before load runs. */
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    if (!prefsReady) return;
    const n = normalizeAiProvider(preferences.aiProvider);
    if (n) setProvider(n);
  }, [prefsReady, preferences.aiProvider]);

  /** Restore draft from user preferences, then server-saved latest memo. */
  useEffect(() => {
    setDraftReady(false);
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
      setPanel(d.markdown ? d.panel : "folder");
      setDraftReady(true);
      return;
    }

    void (async () => {
      const [savedMemo, savedMeta] = await Promise.all([
        fetchSavedFromServer(tk, "ai-credit-memo-latest"),
        fetchSavedFromServer(tk, "ai-credit-memo-latest-meta"),
      ]);
      if (savedMemo && savedMemo.trim()) {
        setMarkdown(savedMemo);
        setPanel("memo");
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
        setDraftReady(true);
        return;
      }

      setProject(null);
      setMarkdown(null);
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

  // Load saved memo variants (latest + voices) so they are visible/downloadable.
  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setSavedMemosLoading(true);
    (async () => {
      const out: Partial<Record<SavedMemoVariantId, SavedMemoLoaded>> = {};
      await Promise.all(
        SAVED_MEMO_VARIANTS.map(async (v) => {
          const md = await fetchSavedFromServer(tk, v.memoKey as any);
          if (!md || !md.trim()) return;
          const metaRaw = await fetchSavedFromServer(tk, v.metaKey as any);
          let meta: SavedMemoLoaded["meta"] = null;
          if (metaRaw && metaRaw.trim()) {
            try {
              meta = JSON.parse(metaRaw) as SavedMemoLoaded["meta"];
            } catch {
              meta = null;
            }
          }
          out[v.id] = { markdown: md, meta };
        })
      );
      if (!cancelled) setSavedMemos(out);
    })()
      .catch(() => {
        if (!cancelled) setSavedMemos({});
      })
      .finally(() => {
        if (!cancelled) setSavedMemosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tk]);

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
    async (markdownText: string, voice: CreditMemoVoiceId | null) => {
      if (!tk || !markdownText.trim()) return;
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

  const pushDeckToLibrary = useCallback(
    async (blob: Blob, deckTitle: string) => {
      if (!tk) return;
      try {
        const fd = new FormData();
        fd.set("action", "addDeck");
        fd.set("title", deckTitle);
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
        [tk]: serializeCreditMemoDraft({
          project,
          jobId,
          outline,
          markdown,
          memoTitle,
          targetWords,
          useTemplate,
          panel,
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
          setOutline(null);
          setJobId(null);
        }
        if (data.ingestWarnings?.length) {
          setIngestError(data.ingestWarnings.join(" "));
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
    setGenLoading(true);
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
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setJobId(data.jobId ?? null);
      setOutline(data.outline ?? null);
      setMarkdown(data.markdown ?? null);
      setLastVoice(voice ?? null);
      setPanel(data.markdown ? "memo" : "outline");

      // Update saved memos list immediately for the generated variant (server writes are best-effort).
      const variantId: SavedMemoVariantId =
        voice === "shakespeare"
          ? "shakespeare"
          : voice === "buffett"
            ? "buffett"
            : voice === "munger"
              ? "munger"
              : voice === "lynch"
                ? "lynch"
                : voice === "soros"
                  ? "soros"
                  : "latest";
      if (data.markdown && data.markdown.trim()) {
        setSavedMemos((prev) => ({
          ...prev,
          [variantId]: { markdown: data.markdown!, meta: { jobId: data.jobId } },
        }));
        void pushMemoToLibrary(data.markdown, voice ?? null);
      }
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
      setGenLoading(false);
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
      const blob = await res.blob();
      void pushDeckToLibrary(blob, deckTitle);
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

  return (
    <div className="space-y-4">
      <Card title={`AI Memo and Deck — ${tk}`}>
        <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          When you are signed in, your server-side data for this ticker (cloud workspace files, saved tab text, and Saved Documents)
          is included automatically. If <code className="text-[10px]">RESEARCH_ROOT_DIR</code> is configured, the server picks the best-matching
          research folder for this ticker. Click <strong>Refresh Source, Ingest &amp; Index</strong> to re-scan and rebuild the indexed
          source pack — the LLM only cites that pack.
          Generate credit Deck produces a first-draft PowerPoint (slide titles match the memo outline; the shaded area on each slide is for your charts).
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <TabButton active={panel === "folder"} onClick={() => setPanel("folder")}>
            Sources
          </TabButton>
          <TabButton active={panel === "template"} onClick={() => setPanel("template")}>
            Template
          </TabButton>
          <TabButton active={panel === "outline"} onClick={() => setPanel("outline")}>
            Outline
          </TabButton>
          <TabButton active={panel === "memo"} onClick={() => setPanel("memo")} disabled={!markdown}>
            Memo
          </TabButton>
          <TabButton active={panel === "export"} onClick={() => setPanel("export")} disabled={!markdown}>
            Export
          </TabButton>
        </div>

        {panel === "folder" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
                  Ticker
                </div>
                <input
                  readOnly
                  value={tk}
                  className={`${MEMO_FIELD_CLASS} font-mono text-sm`}
                />
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
              <div className="max-h-[50vh] space-y-2 overflow-auto rounded border p-3 text-xs" style={{ borderColor: "var(--border2)" }}>
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
                After a successful refresh, indexed files and chunk counts appear here. On first load, this runs automatically when
                you are signed in.
              </p>
            )}
          </div>
        )}

        {panel === "template" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
                <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
                Use DOCX template outline for memo structure
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
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Current template
              </div>
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
                  No template uploaded yet. Upload a DOCX to control the memo outline.
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

        <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 md:grid-cols-2">
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
              className={MEMO_FIELD_CLASS}
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini (Google)</option>
              <option value="ollama">Ollama / Local Llama</option>
            </select>
            <AiModelPicker provider={provider} className="mt-2" />
          </div>
          <label className="md:col-span-2 mt-1 flex items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
            <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
            Use template outline (if configured)
          </label>
          <div className="md:col-span-2">
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

        <div className="mt-4 flex flex-wrap items-stretch gap-3">
          <button
            type="button"
            disabled={genLoading || deckGenLoading || !project}
            onClick={() => void runGenerate()}
            className={MEMO_GENERATE_BTN_CLASS}
            style={{ borderColor: "var(--accent)", background: "var(--accent)", color: "var(--background,var(--text-invert,#fff))" }}
          >
            {genLoading ? "Generating memo (may take several minutes)…" : "Generate credit memo"}
          </button>
          <button
            type="button"
            disabled={genLoading || deckGenLoading || !project}
            onClick={() => void runGenerateDeck()}
            className={MEMO_GENERATE_BTN_CLASS}
            style={{ borderColor: "var(--accent)", background: "var(--accent)", color: "var(--background,var(--text-invert,#fff))" }}
          >
            {deckGenLoading ? "Generating deck (may take a few minutes)…" : "Generate credit Deck"}
          </button>
          {(SAVED_MEMO_VARIANTS.filter((v) => v.voice) as SavedMemoVariant[]).map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={genLoading || deckGenLoading || !project}
              onClick={() => void runGenerate(v.voice!)}
              className={MEMO_GENERATE_BTN_CLASS}
              style={{
                borderColor: "var(--accent)",
                background: lastVoice === v.voice ? "rgba(0,212,170,0.14)" : "var(--accent)",
                color: lastVoice === v.voice ? "var(--accent)" : "var(--background,var(--text-invert,#fff))",
              }}
              title="Generate memo in this voice"
            >
              {v.label}
            </button>
          ))}
        </div>
        {genError ? <p className="mt-2 text-sm" style={{ color: "var(--warn)" }}>{genError}</p> : null}
        {deckGenError ? <p className="mt-2 text-sm" style={{ color: "var(--warn)" }}>{deckGenError}</p> : null}
        {jobId ? <p className="mt-1 text-[10px] font-mono" style={{ color: "var(--muted)" }}>Job: {jobId}</p> : null}
      </Card>

      <Card title="Memo & deck library">
        <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Successful <strong>Generate credit memo</strong> and <strong>Generate credit Deck</strong> runs are stored here automatically
          in your <strong>account</strong> (Postgres). Use <strong>Delete</strong> to remove an
          item. The <strong>Saved memos</strong> section below still keeps one file per voice slot (Latest, Buffett, …).
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
                    <td className="p-2" style={{ color: "var(--muted2)" }}>
                      {row.kind === "memo" ? (
                        <span>
                          {(row.variant ? `Variant: ${row.variant}` : "") +
                            (row.provider ? `${row.variant ? " · " : ""}${row.provider}` : "")}
                        </span>
                      ) : (
                        <span>PowerPoint</span>
                      )}
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
                                    setMarkdown(j.markdown);
                                    setPanel("memo");
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
                          <a
                            href={`/api/credit-memo/library/${encodeURIComponent(tk)}?deckId=${encodeURIComponent(row.id)}`}
                            className="inline-block rounded border px-2 py-1 text-[10px] font-semibold no-underline"
                            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                            download
                          >
                            Download
                          </a>
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
                                if (res.ok) await loadLibrary();
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

      <Card title="Saved memos">
        {savedMemosLoading ? (
          <p className="text-sm py-2" style={{ color: "var(--muted2)" }}>
            Loading saved memos…
          </p>
        ) : (
          <div className="space-y-2">
            {SAVED_MEMO_VARIANTS.map((v) => {
              const item = savedMemos[v.id];
              if (!item?.markdown?.trim()) return null;
              const createdAt = item.meta?.createdAt;
              return (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                  style={{ borderColor: "var(--border2)", background: "var(--card)" }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {v.label}
                    </div>
                    {createdAt ? (
                      <div className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
                        {createdAt}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded border px-3 py-2 text-sm font-semibold"
                      style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                      onClick={() => {
                        setMarkdown(item.markdown);
                        setPanel("memo");
                        setLastVoice(v.voice);
                      }}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="rounded border px-3 py-2 text-sm font-semibold"
                      style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                      onClick={() => downloadTextFile(`${tk}_${v.id}_memo.md`, item.markdown, "text/markdown; charset=utf-8")}
                    >
                      Download Markdown
                    </button>
                    <button
                      type="button"
                      className="rounded border px-3 py-2 text-sm font-semibold"
                      style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
                      onClick={() => {
                        void (async () => {
                          const sp = await fetchSavedFromServer(tk, v.sourcePackKey as any);
                          if (!sp || !sp.trim()) return;
                          downloadTextFile(`${tk}_${v.id}_source-pack.txt`, sp, "text/plain; charset=utf-8");
                        })();
                      }}
                    >
                      Download Source Pack
                    </button>
                  </div>
                </div>
              );
            })}
            {!Object.keys(savedMemos).length ? (
              <p className="text-sm py-2" style={{ color: "var(--muted2)" }}>
                No saved memos yet. Generate one above and it will appear here.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {panel === "outline" && (
        <Card title="Planned outline">
          {outline ? (
            <ul className="list-inside list-disc space-y-1 text-sm" style={{ color: "var(--muted2)" }}>
              {outline.sections.map((s) => (
                <li key={s.id}>
                  <strong style={{ color: "var(--text)" }}>{s.title}</strong> — ~{s.targetWords} words. {s.emphasis}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Run generation to build outline, or it will appear here after a successful run.
            </p>
          )}
        </Card>
      )}

      {panel === "memo" && markdown && (
        <Card title="Memo draft">
          <div className="max-w-none text-sm leading-relaxed [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_li]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-[var(--accent)] [&_a]:underline [&_table]:text-xs [&_code]:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
          </div>
        </Card>
      )}

      {panel === "export" && jobId && markdown && (
        <Card title="Export">
          <p className="mb-2 text-sm" style={{ color: "var(--muted2)" }}>
            Downloads use the last generated job.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/credit-memo/memo/${encodeURIComponent(jobId)}/export?format=md`}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              Download Markdown
            </a>
            <a
              href={`/api/credit-memo/memo/${encodeURIComponent(jobId)}/export?format=html`}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              Download HTML
            </a>
            <a
              href={`/api/credit-memo/memo/${encodeURIComponent(jobId)}/export?format=docx`}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            >
              Download DOCX
            </a>
            <a
              href={`/api/credit-memo/memo/${encodeURIComponent(jobId)}/export?format=source-pack`}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              Download Source Pack
            </a>
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

  const activeTemplate = index.templates.find((t) => t.id === active) ?? null;

  return (
    <div className="space-y-3">
      {activeTemplate ? (
        <div className="rounded border p-2 text-xs" style={{ borderColor: "var(--border)" }}>
          <div className="font-semibold" style={{ color: "var(--text)" }}>
            Active template: {activeTemplate.filename}
          </div>
          <div style={{ color: "var(--muted)" }}>Uploaded: {activeTemplate.uploadedAt}</div>
          <div className="mt-2 max-h-40 overflow-auto rounded border p-2 text-[11px]" style={{ borderColor: "var(--border2)" }}>
            <ol className="list-decimal space-y-0.5 pl-5" style={{ color: "var(--muted2)" }}>
              {activeTemplate.outlineTitles.slice(0, 30).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      <div className="max-h-44 overflow-auto rounded border" style={{ borderColor: "var(--border2)" }}>
        <table className="w-full text-left text-[11px]">
          <thead style={{ color: "var(--muted)" }}>
            <tr>
              <th className="p-2">Template</th>
              <th className="p-2">Uploaded</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {index.templates.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="p-2">
                  <div style={{ color: t.id === active ? "var(--accent)" : "var(--text)" }}>
                    {t.filename} {t.id === active ? "(active)" : ""}
                  </div>
                </td>
                <td className="p-2" style={{ color: "var(--muted2)" }}>
                  {t.uploadedAt}
                </td>
                <td className="p-2 flex gap-2">
                  <button
                    type="button"
                    className="underline"
                    disabled={busyId === t.id}
                    onClick={() => {
                      setBusyId(t.id);
                      void onSelect(t.id).finally(() => setBusyId(null));
                    }}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="underline"
                    style={{ color: "var(--warn)" }}
                    disabled={busyId === t.id}
                    onClick={() => {
                      if (!confirm(`Delete template ${t.filename}?`)) return;
                      setBusyId(t.id);
                      void onDelete(t.id).finally(() => setBusyId(null));
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
