import type { MemoDeckRunGuideState } from "@/components/credit-memo/MemoDeckRunGuidePanel";
import { fetchSavedFromServer, saveToServer, type SavedDataKey } from "@/lib/saved-data-client";
import type { MemoOutline } from "@/lib/creditMemo/types";
import type { MemoPromptSharedContext } from "@/lib/creditMemo/memoPromptSharedContext";
import { rebuildCreditMemoPromptFromSharedContext } from "@/lib/creditMemo/memoPromptAssembly";
import type { CreditMemoVoiceId } from "@/data/credit-memo-voices";
import { creditMemoVoiceSystemPrompt } from "@/data/credit-memo-voices";

export const MEMO_DECK_BUILT_PROMPT_CACHE_KEY = "ai-memo-deck-built-prompt-cache" as SavedDataKey;

const SESSION_CACHE_PREFIX = "cec:memo-deck-prompt-cache:";

export type MemoDeckBuiltPrompt = {
  systemPrompt: string;
  userPrompt: string;
  copyPrompt: string;
  systemChars: number;
  userChars: number;
  retrievalUsed: boolean;
};

export type MemoDeckBuiltPromptEntry = {
  builtPrompt: MemoDeckBuiltPrompt;
  lastRunGuide: MemoDeckRunGuideState | null;
  builtAt: string;
  projectId: string | null;
  outline: MemoOutline | null;
};

export type MemoDeckBuiltPromptCache = {
  version: 2;
  sharedContext: MemoPromptSharedContext | null;
  byProductKey: Record<string, MemoDeckBuiltPromptEntry>;
};

export function emptyMemoDeckBuiltPromptCache(): MemoDeckBuiltPromptCache {
  return { version: 2, sharedContext: null, byProductKey: {} };
}

function sessionCacheKey(ticker: string): string {
  return `${SESSION_CACHE_PREFIX}${ticker.trim().toUpperCase()}`;
}

export function readMemoDeckBuiltPromptCacheFromSession(ticker: string): MemoDeckBuiltPromptCache | null {
  if (typeof window === "undefined") return null;
  const tk = ticker?.trim();
  if (!tk) return null;
  try {
    const raw = sessionStorage.getItem(sessionCacheKey(tk));
    if (!raw?.trim()) return null;
    return parseMemoDeckBuiltPromptCache(raw);
  } catch {
    return null;
  }
}

export function writeMemoDeckBuiltPromptCacheToSession(ticker: string, cache: MemoDeckBuiltPromptCache): void {
  if (typeof window === "undefined") return;
  const tk = ticker?.trim();
  if (!tk) return;
  try {
    sessionStorage.setItem(sessionCacheKey(tk), JSON.stringify(cache));
  } catch {
    /* quota — server copy may still work */
  }
}

function normalizeBuiltPrompt(raw: unknown): MemoDeckBuiltPrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const systemPrompt = typeof o.systemPrompt === "string" ? o.systemPrompt : "";
  const userPrompt = typeof o.userPrompt === "string" ? o.userPrompt : "";
  let copyPrompt = typeof o.copyPrompt === "string" ? o.copyPrompt : "";
  if (!copyPrompt.trim() && (systemPrompt.trim() || userPrompt.trim())) {
    copyPrompt = [systemPrompt.trim(), userPrompt.trim()].filter(Boolean).join("\n\n---\n\n");
  }
  if (!copyPrompt.trim()) return null;
  return {
    systemPrompt,
    userPrompt,
    copyPrompt,
    systemChars:
      typeof o.systemChars === "number" && Number.isFinite(o.systemChars)
        ? o.systemChars
        : systemPrompt.length,
    userChars:
      typeof o.userChars === "number" && Number.isFinite(o.userChars)
        ? o.userChars
        : userPrompt.length,
    retrievalUsed: o.retrievalUsed === true,
  };
}

function isBuiltPrompt(v: unknown): v is MemoDeckBuiltPrompt {
  return normalizeBuiltPrompt(v) != null;
}

function isSharedContext(v: unknown): v is MemoPromptSharedContext {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.fingerprint === "string" &&
    typeof o.projectId === "string" &&
    o.outline != null &&
    typeof o.outline === "object" &&
    typeof o.inventory === "string" &&
    typeof o.evidence === "string" &&
    typeof o.memoTitle === "string" &&
    typeof o.ticker === "string"
  );
}

function isEntry(v: unknown): v is MemoDeckBuiltPromptEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const builtPrompt = normalizeBuiltPrompt(o.builtPrompt);
  if (!builtPrompt) return false;
  if (typeof o.builtAt !== "string") return false;
  if (o.projectId != null && typeof o.projectId !== "string") return false;
  if (o.outline != null && typeof o.outline !== "object") return false;
  return true;
}

function normalizeEntry(v: unknown): MemoDeckBuiltPromptEntry | null {
  if (!isEntry(v)) return null;
  const o = v as MemoDeckBuiltPromptEntry;
  const builtPrompt = normalizeBuiltPrompt((v as MemoDeckBuiltPromptEntry).builtPrompt);
  if (!builtPrompt) return null;
  return { ...o, builtPrompt };
}

export type ResolvedMemoDeckBuiltPrompt = {
  builtPrompt: MemoDeckBuiltPrompt;
  lastRunGuide: MemoDeckRunGuideState | null;
  outline: MemoOutline | null;
  statusMessage: string;
};

/** Resolve display prompt for a product key from cache (client-safe, no fingerprint required). */
export function resolveMemoDeckBuiltPromptForProduct(
  cache: MemoDeckBuiltPromptCache,
  productKey: string,
  voice: CreditMemoVoiceId | null,
  productKind: "memo" | "deck"
): ResolvedMemoDeckBuiltPrompt | null {
  const entry = cache.byProductKey[productKey];
  const normalizedEntry = entry ? normalizeEntry(entry) : null;
  if (normalizedEntry) {
    return {
      builtPrompt: normalizedEntry.builtPrompt,
      lastRunGuide: normalizedEntry.lastRunGuide ?? null,
      outline: normalizedEntry.outline,
      statusMessage: "Context window restored from your last build.",
    };
  }
  if (productKind === "memo" && cache.sharedContext) {
    const voicePrompt = voice ? creditMemoVoiceSystemPrompt(voice) : null;
    const rebuilt = rebuildCreditMemoPromptFromSharedContext(cache.sharedContext, voicePrompt);
    return {
      builtPrompt: {
        systemPrompt: rebuilt.systemPrompt,
        userPrompt: rebuilt.userPrompt,
        copyPrompt: rebuilt.copyPrompt,
        systemChars: rebuilt.systemPrompt.length,
        userChars: rebuilt.userPrompt.length,
        retrievalUsed: rebuilt.retrievalUsed,
      },
      lastRunGuide: {
        kind: "memo",
        sentSystemMessage: rebuilt.systemPrompt,
        sentUserMessage: rebuilt.userPrompt,
        userBreakdown: cache.sharedContext.userMessageBreakdown,
        evidenceDiagnostics: cache.sharedContext.evidenceDiagnostics,
        systemChars: rebuilt.systemPrompt.length,
      },
      outline: rebuilt.outline,
      statusMessage: "Prompt updated for this memo type (same source pack).",
    };
  }
  return null;
}

export function cacheHasBuiltPromptData(cache: MemoDeckBuiltPromptCache): boolean {
  return Boolean(cache.sharedContext) || Object.keys(cache.byProductKey).length > 0;
}

/** Session holds the built prompt only — not the full evidence pack (too large for sessionStorage). */
export function slimMemoDeckBuiltPromptCacheForSession(
  cache: MemoDeckBuiltPromptCache,
  activeProductKey: string
): MemoDeckBuiltPromptCache {
  const entry = cache.byProductKey[activeProductKey];
  return {
    version: 2,
    sharedContext: null,
    byProductKey: entry ? { [activeProductKey]: entry } : {},
  };
}

export function parseMemoDeckBuiltPromptCache(raw: string): MemoDeckBuiltPromptCache | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      sharedContext?: unknown;
      byProductKey?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return null;
    const byProductKey: Record<string, MemoDeckBuiltPromptEntry> = {};
    if (parsed.byProductKey && typeof parsed.byProductKey === "object") {
      for (const [key, entry] of Object.entries(parsed.byProductKey as Record<string, unknown>)) {
        const normalized = normalizeEntry(entry);
        if (normalized) byProductKey[key] = normalized;
      }
    }
    const sharedContext = isSharedContext(parsed.sharedContext) ? parsed.sharedContext : null;
    return { version: 2, sharedContext, byProductKey };
  } catch {
    return null;
  }
}

function mergeCaches(
  session: MemoDeckBuiltPromptCache | null,
  server: MemoDeckBuiltPromptCache | null
): MemoDeckBuiltPromptCache {
  if (!session && !server) return emptyMemoDeckBuiltPromptCache();
  if (!session) return server ?? emptyMemoDeckBuiltPromptCache();
  if (!server) return session;
  const sessionSharedAt = session.sharedContext?.builtAt ?? "";
  const serverSharedAt = server.sharedContext?.builtAt ?? "";
  const sharedContext =
    sessionSharedAt >= serverSharedAt ? session.sharedContext : server.sharedContext ?? session.sharedContext;
  return {
    version: 2,
    sharedContext,
    byProductKey: { ...server.byProductKey, ...session.byProductKey },
  };
}

export async function fetchMemoDeckBuiltPromptCache(ticker: string): Promise<MemoDeckBuiltPromptCache> {
  const session = readMemoDeckBuiltPromptCacheFromSession(ticker);
  const raw = await fetchSavedFromServer(ticker, MEMO_DECK_BUILT_PROMPT_CACHE_KEY);
  const server = raw?.trim() ? parseMemoDeckBuiltPromptCache(raw) : null;
  return mergeCaches(session, server);
}

export async function persistMemoDeckBuiltPromptCache(
  ticker: string,
  cache: MemoDeckBuiltPromptCache,
  activeProductKey?: string
): Promise<boolean> {
  const sessionPayload =
    activeProductKey != null
      ? slimMemoDeckBuiltPromptCacheForSession(cache, activeProductKey)
      : cache;
  writeMemoDeckBuiltPromptCacheToSession(ticker, sessionPayload);
  return saveToServer(ticker, MEMO_DECK_BUILT_PROMPT_CACHE_KEY, JSON.stringify(cache));
}

/** @deprecated use persistMemoDeckBuiltPromptCache */
export async function saveMemoDeckBuiltPromptCache(ticker: string, cache: MemoDeckBuiltPromptCache): Promise<boolean> {
  return persistMemoDeckBuiltPromptCache(ticker, cache);
}

export function upsertProductBuiltPrompt(
  cache: MemoDeckBuiltPromptCache,
  productKey: string,
  entry: MemoDeckBuiltPromptEntry
): MemoDeckBuiltPromptCache {
  return {
    ...cache,
    byProductKey: {
      ...cache.byProductKey,
      [productKey]: entry,
    },
  };
}

export function upsertSharedContext(
  cache: MemoDeckBuiltPromptCache,
  sharedContext: MemoPromptSharedContext
): MemoDeckBuiltPromptCache {
  return { ...cache, sharedContext };
}
