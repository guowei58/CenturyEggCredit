"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { SourceInventoryPanel } from "@/components/credit-memo/SourceInventoryPanel";
import { MemoDeckRunGuidePanel, type MemoDeckRunGuideState } from "@/components/credit-memo/MemoDeckRunGuidePanel";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { SavedResponseExpandableShell, SAVED_RESPONSE_EDIT_CLASS, SAVED_RESPONSE_SHELL_CLASS, SAVED_RESPONSE_VIEW_CLASS } from "@/components/SavedResponseExpandableShell";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import {
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
import {
  cacheHasBuiltPromptData,
  emptyMemoDeckBuiltPromptCache,
  fetchMemoDeckBuiltPromptCache,
  persistMemoDeckBuiltPromptCache,
  readMemoDeckBuiltPromptCacheFromSession,
  resolveMemoDeckBuiltPromptForProduct,
  upsertProductBuiltPrompt,
  upsertSharedContext,
  type MemoDeckBuiltPrompt,
  type MemoDeckBuiltPromptCache,
} from "@/lib/creditMemo/builtPromptCache";
import {
  buildMemoPromptSharedContextFingerprint,
  type MemoPromptSharedContext,
} from "@/lib/creditMemo/memoPromptSharedContext";
import type { MemoDeckLibraryEntry } from "@/lib/ai-memo-deck-library";
import { fetchSavedFromServer, saveToServer, type SavedDataKey } from "@/lib/saved-data-client";
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

type MemoDeckProductKind = "memo" | "deck";

type MemoDeckProductOption = {
  key: string;
  label: string;
  kind: MemoDeckProductKind;
  voice: CreditMemoVoiceId | null;
};

const MEMO_DECK_PRODUCT_OPTIONS: readonly MemoDeckProductOption[] = [
  { key: "memo", label: "Generate credit memo", kind: "memo", voice: null },
  { key: "deck", label: "Generate credit Deck", kind: "deck", voice: null },
  ...(SAVED_MEMO_VARIANTS.filter((v) => v.voice != null) as Array<SavedMemoVariant & { voice: CreditMemoVoiceId }>).map(
    (v) => ({
      key: v.id,
      label: v.label,
      kind: "memo" as const,
      voice: v.voice,
    })
  ),
];

function memoVariantForVoice(voice: CreditMemoVoiceId | null): SavedMemoVariant {
  if (!voice) return SAVED_MEMO_VARIANTS[0];
  return SAVED_MEMO_VARIANTS.find((v) => v.voice === voice) ?? SAVED_MEMO_VARIANTS[0];
}

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

function builtPromptFromParts(parts: {
  systemPrompt: string;
  userPrompt: string;
  copyPrompt: string;
  retrievalUsed: boolean;
}): MemoDeckBuiltPrompt {
  return {
    systemPrompt: parts.systemPrompt,
    userPrompt: parts.userPrompt,
    copyPrompt: parts.copyPrompt,
    systemChars: parts.systemPrompt.length,
    userChars: parts.userPrompt.length,
    retrievalUsed: parts.retrievalUsed,
  };
}

function initialPromptCacheForTicker(ticker: string): MemoDeckBuiltPromptCache {
  if (!ticker.trim()) return emptyMemoDeckBuiltPromptCache();
  return readMemoDeckBuiltPromptCacheFromSession(ticker) ?? emptyMemoDeckBuiltPromptCache();
}

function initialBuiltPromptForTicker(ticker: string, productKey: string): {
  builtPrompt: MemoDeckBuiltPrompt | null;
  lastRunGuide: MemoDeckRunGuideState | null;
  promptStatus: string | null;
} {
  const cache = initialPromptCacheForTicker(ticker);
  const product =
    MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === productKey) ?? MEMO_DECK_PRODUCT_OPTIONS[0];
  const resolved = resolveMemoDeckBuiltPromptForProduct(
    cache,
    productKey,
    product.voice,
    product.kind
  );
  if (!resolved) {
    return { builtPrompt: null, lastRunGuide: null, promptStatus: null };
  }
  return {
    builtPrompt: resolved.builtPrompt,
    lastRunGuide: resolved.lastRunGuide,
    promptStatus: resolved.statusMessage,
  };
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

  const [genError, setGenError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [outline, setOutline] = useState<MemoOutline | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
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

  const [isEditing, setIsEditing] = useState(true);
  const [editDraft, setEditDraft] = useState("");
  const initialPrompt = initialBuiltPromptForTicker(tk, "memo");
  const [builtPrompt, setBuiltPrompt] = useState<MemoDeckBuiltPrompt | null>(initialPrompt.builtPrompt);
  const builtPromptCacheRef = useRef<MemoDeckBuiltPromptCache>(initialPromptCacheForTicker(tk));
  const builtPromptCacheHydratedRef = useRef(cacheHasBuiltPromptData(builtPromptCacheRef.current));
  const [buildingPrompt, setBuildingPrompt] = useState(false);
  const [promptStatus, setPromptStatus] = useState<string | null>(initialPrompt.promptStatus);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [selectedProductKey, setSelectedProductKey] = useState("memo");
  const selectedProductKeyRef = useRef(selectedProductKey);
  selectedProductKeyRef.current = selectedProductKey;
  const [lastRunGuide, setLastRunGuide] = useState<MemoDeckRunGuideState | null>(initialPrompt.lastRunGuide);

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
      setIsEditing(!d.markdown?.trim());
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
        setIsEditing(false);
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

  const getContextFingerprint = useCallback(() => {
    if (!project?.id || project.sources.length === 0) return null;
    return buildMemoPromptSharedContextFingerprint({
      projectId: project.id,
      sourceRelPaths: project.sources.map((s) => s.relPath),
      targetWords,
      useTemplate,
      memoTitle: memoTitle.trim() || defaultTitle,
    });
  }, [project, targetWords, useTemplate, memoTitle, defaultTitle]);

  const applyBuiltPromptForProduct = useCallback((productKey: string) => {
    const cache = builtPromptCacheRef.current;
    const product =
      MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === productKey) ?? MEMO_DECK_PRODUCT_OPTIONS[0];

    const resolved = resolveMemoDeckBuiltPromptForProduct(
      cache,
      productKey,
      product.voice,
      product.kind
    );
    if (resolved) {
      setBuiltPrompt(resolved.builtPrompt);
      setLastRunGuide(resolved.lastRunGuide);
      if (resolved.outline) setOutline(resolved.outline);
      setPromptStatus(resolved.statusMessage);
      setClipboardFailed(false);
      return;
    }

    setBuiltPrompt(null);
    setLastRunGuide(null);
    setPromptStatus(null);
    setClipboardFailed(false);
  }, []);

  const applyBuiltPromptRef = useRef(applyBuiltPromptForProduct);
  applyBuiltPromptRef.current = applyBuiltPromptForProduct;

  /** Reload cache from server when tab mounts (session already applied synchronously). */
  useEffect(() => {
    if (!tk || authStatus !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      const cache = await fetchMemoDeckBuiltPromptCache(tk);
      if (cancelled) return;
      builtPromptCacheRef.current = cache;
      builtPromptCacheHydratedRef.current = cacheHasBuiltPromptData(cache);
      applyBuiltPromptRef.current(selectedProductKeyRef.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [tk, authStatus]);

  /** Retry restore after project sources load (server fetch may finish before ingest completes). */
  useEffect(() => {
    if (!tk || !builtPromptCacheHydratedRef.current) return;
    if (builtPrompt?.copyPrompt?.trim()) return;
    if (!cacheHasBuiltPromptData(builtPromptCacheRef.current)) return;
    applyBuiltPromptRef.current(selectedProductKeyRef.current);
  }, [tk, project?.sources?.length, builtPrompt?.copyPrompt]);

  const prevSelectedProductKeyRef = useRef(selectedProductKey);
  useEffect(() => {
    if (prevSelectedProductKeyRef.current === selectedProductKey) return;
    prevSelectedProductKeyRef.current = selectedProductKey;
    if (!builtPromptCacheHydratedRef.current) return;
    applyBuiltPromptForProduct(selectedProductKey);
  }, [selectedProductKey, applyBuiltPromptForProduct]);

  /** When ticker changes, restore that ticker's cached prompt immediately. */
  useEffect(() => {
    if (!tk) return;
    const cache = initialPromptCacheForTicker(tk);
    builtPromptCacheRef.current = cache;
    builtPromptCacheHydratedRef.current = cacheHasBuiltPromptData(cache);
    const product =
      MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === selectedProductKeyRef.current) ??
      MEMO_DECK_PRODUCT_OPTIONS[0];
    const resolved = resolveMemoDeckBuiltPromptForProduct(
      cache,
      selectedProductKeyRef.current,
      product.voice,
      product.kind
    );
    setBuiltPrompt(resolved?.builtPrompt ?? null);
    setLastRunGuide(resolved?.lastRunGuide ?? null);
    setPromptStatus(resolved?.statusMessage ?? null);
  }, [tk]);

  const selectProduct = useCallback(
    async (key: string) => {
      setSelectedProductKey(key);
      applyBuiltPromptForProduct(key);
      const opt = MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === key);
      if (!opt || opt.kind === "deck" || !tk) return;
      const variant = memoVariantForVoice(opt.voice);
      const saved = await fetchSavedFromServer(tk, variant.memoKey as SavedDataKey);
      if (saved?.trim()) {
        setMarkdown(saved);
        setIsEditing(false);
        setEditDraft("");
      }
    },
    [tk, applyBuiltPromptForProduct]
  );

  const runResolve = useCallback(async () => {
    if (!tk) return;
    setResolveLoading(true);
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
        const prevFp = builtPromptCacheRef.current.sharedContext?.fingerprint;
        const nextFp = buildMemoPromptSharedContextFingerprint({
          projectId: nextProject.id,
          sourceRelPaths: nextProject.sources.map((s) => s.relPath),
          targetWords,
          useTemplate,
          memoTitle: memoTitle.trim() || defaultTitle,
        });
        setProject(nextProject);
        if (prevId && nextProject.id !== prevId) {
          setMarkdown(null);
          setOutline(null);
          setJobId(null);
        }
        if (prevFp && prevFp !== nextFp && tk) {
          builtPromptCacheRef.current = emptyMemoDeckBuiltPromptCache();
          setBuiltPrompt(null);
          setLastRunGuide(null);
          setPromptStatus(null);
          void persistMemoDeckBuiltPromptCache(tk, builtPromptCacheRef.current);
        }
      } catch (e) {
        setIngestError(e instanceof Error ? e.message : "Ingest failed");
      } finally {
        setIngestLoading(false);
      }
    },
    [tk, resolved, project?.id, targetWords, useTemplate, memoTitle, defaultTitle]
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

  const buildContextWindow = useCallback(async () => {
    if (!project) {
      setGenError('Click "Refresh sources" first.');
      return;
    }
    const selectedProduct =
      MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === selectedProductKey) ?? MEMO_DECK_PRODUCT_OPTIONS[0];
    setBuildingPrompt(true);
    setGenError(null);
    setPromptStatus(null);
    try {
      const isDeck = selectedProduct.kind === "deck";
      const endpoint = isDeck ? "deck-prompt" : "memo-prompt";
      const res = await fetch(`/api/credit-memo/project/${encodeURIComponent(project.id)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetWords,
          memoTitle: memoTitle.trim() || defaultTitle,
          deckTitle: `${memoTitle.trim() || defaultTitle}`.replace(/Credit Memo/i, "Credit Deck"),
          useTemplate,
          voice: selectedProduct.voice ?? undefined,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        outline?: MemoOutline;
        systemPrompt?: string;
        userPrompt?: string;
        copyPrompt?: string;
        systemChars?: number;
        userChars?: number;
        retrievalUsed?: boolean;
        userMessageBreakdown?: MemoDeckRunGuideState["userBreakdown"];
        evidenceDiagnostics?: MemoDeckRunGuideState["evidenceDiagnostics"];
        sharedContext?: MemoPromptSharedContext;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to build context window");
      const built: MemoDeckBuiltPrompt = {
        systemPrompt: body.systemPrompt ?? "",
        userPrompt: body.userPrompt ?? "",
        copyPrompt: body.copyPrompt ?? "",
        systemChars: body.systemChars ?? 0,
        userChars: body.userChars ?? 0,
        retrievalUsed: body.retrievalUsed === true,
      };
      const runGuide: MemoDeckRunGuideState | null =
        typeof body.systemPrompt === "string" &&
        typeof body.userPrompt === "string" &&
        body.userMessageBreakdown &&
        body.evidenceDiagnostics
          ? {
              kind: isDeck ? "deck" : "memo",
              sentSystemMessage: body.systemPrompt,
              sentUserMessage: body.userPrompt,
              userBreakdown: body.userMessageBreakdown,
              evidenceDiagnostics: body.evidenceDiagnostics,
              systemChars: body.systemPrompt.length,
            }
          : null;
      setBuiltPrompt(built);
      if (body.outline) setOutline(body.outline);
      if (runGuide) setLastRunGuide(runGuide);
      if (tk) {
        let cache = builtPromptCacheRef.current;
        if (body.sharedContext && !isDeck) {
          cache = upsertSharedContext(cache, body.sharedContext);
        }
        cache = upsertProductBuiltPrompt(cache, selectedProductKey, {
          builtPrompt: built,
          lastRunGuide: runGuide,
          builtAt: new Date().toISOString(),
          projectId: project.id,
          outline: body.outline ?? null,
        });
        builtPromptCacheRef.current = cache;
        builtPromptCacheHydratedRef.current = true;
        const saved = await persistMemoDeckBuiltPromptCache(tk, cache, selectedProductKey);
        if (!saved) {
          setPromptStatus("Context window ready in the Prompt panel (could not save to server — copy it before leaving).");
        } else {
          setPromptStatus("Context window ready in the Prompt panel.");
        }
      } else {
        setPromptStatus("Context window ready in the Prompt panel.");
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to build context window");
    } finally {
      setBuildingPrompt(false);
    }
  }, [project, targetWords, memoTitle, defaultTitle, useTemplate, selectedProductKey, tk]);

  const saveMemoResponse = useCallback(async () => {
    const trimmed = editDraft.trim();
    if (!tk || !trimmed) return;
    const selectedProduct =
      MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === selectedProductKey) ?? MEMO_DECK_PRODUCT_OPTIONS[0];
    if (selectedProduct.kind === "deck") {
      setGenError("Deck output is pasted or saved as slide JSON from the Prompt panel.");
      return;
    }
    setSaveToLibraryBusy(true);
    setGenError(null);
    setLibraryError(null);
    try {
      const saveKey = memoVariantForVoice(selectedProduct.voice).memoKey as SavedDataKey;
      const ok = await saveToServer(tk, saveKey, trimmed);
      if (!ok) throw new Error("Could not save memo.");
      await pushMemoToLibrary(trimmed, selectedProduct.voice ?? null);
      setMarkdown(trimmed);
      setIsEditing(false);
      setEditDraft("");
      setPromptStatus("Saved to library.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save to library.";
      setGenError(msg);
      setLibraryError(msg);
    } finally {
      setSaveToLibraryBusy(false);
    }
  }, [editDraft, tk, selectedProductKey, pushMemoToLibrary]);

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
  const sourceBusy = refreshingSources || buildingPrompt;
  const hasMainContent = Boolean(markdown?.trim() || editDraft.trim());
  const hasSavedMemo = Boolean(markdown?.trim());
  const copyPrompt = builtPrompt?.copyPrompt ?? "";
  const selectedProduct =
    MEMO_DECK_PRODUCT_OPTIONS.find((p) => p.key === selectedProductKey) ?? MEMO_DECK_PRODUCT_OPTIONS[0];

  async function copyPromptToClipboard() {
    if (!copyPrompt) return;
    setClipboardFailed(false);
    setPromptStatus(null);
    try {
      await navigator.clipboard.writeText(copyPrompt);
      setPromptStatus("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setPromptStatus("Could not copy. Use the prompt below and copy manually.");
    }
  }

  function openInClaude() {
    if (!copyPrompt) return;
    void openClaudeWithClipboard(copyPrompt, setPromptStatus, setClipboardFailed);
  }

  function openInChatGPT() {
    if (!copyPrompt) return;
    void openChatGptWithClipboard(copyPrompt, setPromptStatus, setClipboardFailed);
  }

  function openInDeepSeek() {
    if (!copyPrompt) return;
    openDeepSeekWithClipboard(copyPrompt, setPromptStatus, setClipboardFailed);
  }

  function openInGemini() {
    if (!copyPrompt) return;
    openGeminiWithClipboard(copyPrompt, setPromptStatus, setClipboardFailed);
  }

  const sourceToolbar = (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Memo / deck type
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {MEMO_DECK_PRODUCT_OPTIONS.map((opt) => {
            const selected = selectedProductKey === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => void selectProduct(opt.key)}
                className={MEMO_ACTION_BTN}
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  background: selected ? "rgba(0,212,170,0.14)" : "transparent",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
        Choose the memo or deck type above, then click <strong>Refresh sources</strong> and{" "}
        <strong>Build context window</strong>, then open the <strong>Prompt</strong> panel on the right to copy or run
        the assembled prompt.
      </p>
      <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Sources: KPI Commentary, Forensic Analysis, LME Analysis, and Recommendation work products; latest 10-K and
        10-Q; all saved tab responses (.txt); Period Financials management presentations; and earnings transcripts.
      </p>
      {needsSignIn ? (
        <p className="text-xs rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
          Sign in to resolve your ticker workspace, ingest sources, and generate memos and decks. Saved output is stored per account.
        </p>
      ) : null}
      {refreshingSources && project ? (
        <p className="text-[11px] flex items-center gap-2" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          Refreshing sources…
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={sourceBusy || needsSignIn}
          onClick={() => void runResolve()}
          className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          {resolveLoading ? "Scanning…" : ingestLoading ? "Ingesting…" : "Refresh sources"}
        </button>
        <button
          type="button"
          disabled={sourceBusy || !project || needsSignIn}
          onClick={() => void buildContextWindow()}
          className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          {buildingPrompt ? "Building…" : "Build context window"}
        </button>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          {project
            ? `${project.sources.length} source block${project.sources.length === 1 ? "" : "s"} indexed`
            : "No ingested project yet"}
        </span>
      </div>
      {genError ? (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {genError}
        </p>
      ) : null}
      <details className="rounded border text-xs" style={{ borderColor: "var(--border2)" }} open={panel === "folder"}>
        <summary
          className="cursor-pointer px-3 py-2 font-medium"
          style={{ color: "var(--muted2)" }}
          onClick={() => setPanel("folder")}
        >
          Source inventory
        </summary>
        <div className="px-3 pb-3">
          <SourceInventoryPanel
            project={project}
            resolveFailed={resolveFailed}
            ingestError={ingestError}
            needsSignIn={needsSignIn}
            listMaxHeightClass="max-h-[40vh]"
            emptyHint={
              <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
                No indexed files yet. Click <strong>Refresh sources</strong> after signing in, or wait for the automatic resolve on first load.
              </p>
            }
          />
        </div>
      </details>
      <details className="rounded border text-xs" style={{ borderColor: "var(--border2)" }} open={panel === "template"}>
        <summary
          className="cursor-pointer px-3 py-2 font-medium"
          style={{ color: "var(--muted2)" }}
          onClick={() => setPanel("template")}
        >
          Memo settings &amp; DOCX template
        </summary>
        <div className="space-y-3 px-3 pb-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
                Memo title
              </div>
              <input value={memoTitle} onChange={(e) => setMemoTitle(e.target.value)} className={MEMO_FIELD_CLASS} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
            <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
            Use uploaded DOCX template outline for memo sections (recommended)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshTemplate()}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              Refresh template list
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
            {templateLoading ? (
              <p className="text-xs" style={{ color: "var(--muted2)" }}>Loading…</p>
            ) : templateIndex && templateIndex.templates.length > 0 ? (
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
            ) : (
              <p className="text-xs" style={{ color: "var(--muted2)" }}>
                No memo template yet. Upload a DOCX below or use the shared default on the server.
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
          </div>
          <MemoDeckRunGuidePanel run={lastRunGuide} />
        </div>
      </details>
    </div>
  );

  const promptPanel = (
    <>
      <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
        {OPEN_IN_EXTERNAL_AI_FULL_LINE}
      </p>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        Context window
      </div>
      {builtPrompt ? (
        <>
          {promptStatus ? (
            <p className="text-[10px] mb-2" style={{ color: "var(--accent)" }}>
              {promptStatus}
            </p>
          ) : null}
          <p className="text-[10px] mb-2" style={{ color: "var(--muted)" }}>
            System {builtPrompt.systemChars.toLocaleString()} chars · User {builtPrompt.userChars.toLocaleString()} chars
            {builtPrompt.retrievalUsed ? " · retrieval-ranked pack" : ""}
          </p>
          <div
            className="rounded border p-3 text-xs max-h-[min(55vh,24rem)] overflow-y-auto whitespace-pre-wrap mb-3"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
          >
            {builtPrompt.copyPrompt}
          </div>
        </>
      ) : (
        <div
          className="rounded border p-3 text-xs mb-3 min-h-[4rem] leading-relaxed"
          style={{ borderColor: "var(--border2)", color: "var(--muted)", background: "var(--card)" }}
        >
          No context window yet. Expand <strong>Memo &amp; deck setup</strong> (top of page), then click{" "}
          <strong>Build context window</strong> for <strong>{selectedProduct.label}</strong>. The full prompt blob
          appears in this panel and is kept until you refresh sources or build again.
        </div>
      )}
      <div className="tab-prompt-ai-actions-grid mb-2">
        <button
          type="button"
          onClick={openInClaude}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          Open in Claude
        </button>
        <button
          type="button"
          onClick={openInChatGPT}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
        >
          Open in ChatGPT
        </button>
        <button
          type="button"
          onClick={openInGemini}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
        >
          Open in Gemini
        </button>
        <button
          type="button"
          onClick={openInDeepSeek}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
        >
          Open in DeepSeek
        </button>
        <button
          type="button"
          onClick={() => void copyPromptToClipboard()}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          Copy prompt
        </button>
      </div>
      {builtPrompt ? (
        <TabPromptApiButtons
          userPrompt={builtPrompt.userPrompt}
          systemPrompt={builtPrompt.systemPrompt}
          onResult={(text) => {
            setMarkdown(text);
            setIsEditing(false);
            setEditDraft("");
            setClipboardFailed(false);
            setPromptStatus("API response received — review and save in the main area if needed.");
          }}
          persistAfterResult={async (text) => {
            const trimmed = text.trim();
            if (!tk) return;
            if (selectedProduct.kind === "deck") {
              throw new Error("Deck responses are JSON slide specs — paste the model output here or build a .pptx offline.");
            }
            const saveKey = memoVariantForVoice(selectedProduct.voice).memoKey as SavedDataKey;
            const ok = await saveToServer(tk, saveKey, trimmed);
            if (!ok) throw new Error("Could not save memo.");
            await pushMemoToLibrary(trimmed, selectedProduct.voice ?? null);
            setMarkdown(trimmed);
            setIsEditing(false);
            setEditDraft("");
            setPromptStatus("Saved to library.");
          }}
          className="mt-3 border-t border-[var(--border2)] pt-3"
        />
      ) : null}
      {promptStatus ? (
        <p className="text-xs mb-1 mt-2" style={{ color: "var(--muted2)" }}>
          {promptStatus}
        </p>
      ) : null}
      {clipboardFailed && copyPrompt ? (
        <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
          Select the prompt above and copy manually (Ctrl+C / Cmd+C).
        </p>
      ) : null}
    </>
  );

  const memoLibraryPanel = (
    <details className="shrink-0 rounded border text-xs" style={{ borderColor: "var(--border2)" }}>
      <summary
        className="cursor-pointer select-none px-3 py-2 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--muted)" }}
      >
        Memo &amp; deck library
        {libraryEntries.length > 0 ? ` (${libraryEntries.length})` : ""}
      </summary>
      <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "var(--border2)" }}>
        <p className="mb-2 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          Open a prior memo or deck with <strong>View</strong>. Each click of{" "}
          <strong>Save to Library</strong> in the saved response box adds a new entry.
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!tk}
            onClick={() => void loadLibrary()}
            className="rounded border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
          >
            Refresh list
          </button>
        </div>
      {libraryError ? (
        <p className="mb-2 text-xs" style={{ color: "var(--warn)" }}>
          {libraryError}
        </p>
      ) : null}
      {libraryDeckId ? (
        <div className="mb-2 rounded border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border2)" }}>
          <span style={{ color: "var(--muted2)" }}>
            Library deck: {libraryEntries.find((e) => e.id === libraryDeckId)?.title ?? "Deck"}
          </span>
          <a
            href={`/api/credit-memo/library/${encodeURIComponent(tk)}?deckId=${encodeURIComponent(libraryDeckId)}`}
            className="ml-2 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold no-underline"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            download
          >
            Download .pptx
          </a>
        </div>
      ) : null}
      {libraryLoading && libraryEntries.length === 0 ? (
        <p className="text-xs py-1" style={{ color: "var(--muted2)" }}>
          Loading library…
        </p>
      ) : libraryEntries.length === 0 ? (
        <p className="text-xs py-1" style={{ color: "var(--muted2)" }}>
          No library items yet.
        </p>
      ) : (
        <div className="max-h-[min(28vh,240px)] overflow-auto rounded border" style={{ borderColor: "var(--border2)" }}>
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 z-[1]" style={{ background: "var(--card)", color: "var(--muted)" }}>
              <tr>
                <th className="p-2">Type</th>
                <th className="p-2">Title</th>
                <th className="p-2">When</th>
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
                                  setIsEditing(false);
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
      </div>
    </details>
  );

  const memoMainPanel = (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {memoLibraryPanel}
      <SavedResponseExpandableShell className={SAVED_RESPONSE_SHELL_CLASS} ticker={tk} linkSourceText={isEditing ? editDraft : markdown ?? ""}>
      {!isEditing && markdown?.trim() ? (
        <>
          <p className="mb-2 text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
            Word-like preview below. Exports use the same text as on screen.
            {jobId ? (
              <>
                {" "}
                <strong>Source pack</strong> is tied to the last generate job.
              </>
            ) : null}
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!screenExportBusy}
              onClick={() => void downloadMemoOnScreen("docx")}
              className="rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {screenExportBusy === "docx" ? "Preparing Word…" : "Download Word (.docx)"}
            </button>
            <button
              type="button"
              disabled={!!screenExportBusy}
              onClick={() => void downloadMemoOnScreen("md")}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              {screenExportBusy === "md" ? "Preparing…" : "Markdown"}
            </button>
            <button
              type="button"
              disabled={!!screenExportBusy}
              onClick={() => void downloadMemoOnScreen("html")}
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
            >
              {screenExportBusy === "html" ? "Preparing…" : "HTML"}
            </button>
            {jobId ? (
              <a
                href={`/api/credit-memo/memo/${encodeURIComponent(jobId)}/export?format=source-pack`}
                className="inline-flex items-center rounded border px-3 py-1.5 text-xs no-underline"
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
        </>
      ) : null}
      {isEditing ? (
        <>
          <RichPasteTextarea
            value={editDraft}
            onChange={setEditDraft}
            placeholder="Paste your Claude, ChatGPT, Gemini, or DeepSeek memo here, then click Save to Library."
            className={SAVED_RESPONSE_EDIT_CLASS}
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          />
          <button
            type="button"
            disabled={saveToLibraryBusy || !editDraft.trim()}
            onClick={() => void saveMemoResponse()}
            className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {saveToLibraryBusy ? "Saving…" : "Save to Library"}
          </button>
        </>
      ) : (
        <>
          <div
            className={`credit-memo-word-preview ${SAVED_RESPONSE_VIEW_CLASS}`}
            style={{ color: "var(--text)" }}
          >
            {markdown?.trim() ? (
              <SavedRichText content={markdown} ticker={tk} />
            ) : selectedProduct.kind === "deck" ? (
              <span style={{ color: "var(--muted)" }}>
                Credit deck output is slide JSON from the model. Run the deck prompt in the Prompt panel, then paste the
                response here if you want to keep a copy.
              </span>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                Generate a memo, paste a response from an external AI, or open a library memo with View.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setEditDraft(markdown ?? "");
              setIsEditing(true);
            }}
            className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            Replace / Edit
          </button>
        </>
      )}
    </SavedResponseExpandableShell>
    </div>
  );

  return (
    <Card title={`AI Memo and Deck — ${tk}`}>
      <TabPromptSlideOutShell
        hasMainContent={hasMainContent}
        hasPromptContent={Boolean(builtPrompt?.copyPrompt)}
        toolbarAlign="start"
        toolbar={sourceToolbar}
        collapsibleToolbar
        collapseToolbarWhen={hasSavedMemo}
        collapsibleToolbarLabel="Memo & deck setup"
        main={memoMainPanel}
        prompt={promptPanel}
      />
    </Card>
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
