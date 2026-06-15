import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import {
  gatherCreativeWorkspaceSources,
  type CreativeWorkspaceSourceKind,
} from "@/lib/creative-workspace-sources";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { getDeepSeekModel } from "@/lib/deepseek";
import type { SavedDataKey } from "@/lib/saved-ticker-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type MetaJson = { fingerprint: string; updatedAt: string };

const SOURCE_KINDS = new Set<CreativeWorkspaceSourceKind>([
  "literary",
  "biblical",
  "dumbass",
  "earnings-transcript",
  "other-memos",
]);

const SAVED_KEYS_BY_PROMPT_KIND: Record<
  Exclude<CreativeWorkspaceSourceKind, "other-memos">,
  { content: SavedDataKey; meta: SavedDataKey }
> = {
  literary: {
    content: "literary-references-latest",
    meta: "literary-references-latest-meta",
  },
  biblical: {
    content: "biblical-references-latest",
    meta: "biblical-references-latest-meta",
  },
  dumbass: {
    content: "how-to-look-like-a-dumbass-latest",
    meta: "how-to-look-like-a-dumbass-latest-meta",
  },
  "earnings-transcript": {
    content: "next-quarter-earnings-transcript-latest",
    meta: "next-quarter-earnings-transcript-latest-meta",
  },
};

function parseMeta(raw: string | null): MetaJson | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Partial<MetaJson> & Record<string, unknown>;
    if (typeof o.fingerprint === "string" && typeof o.updatedAt === "string") {
      return { fingerprint: o.fingerprint, updatedAt: o.updatedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; ticker: string }> }
) {
  const { kind: kindRaw, ticker } = await params;
  const kind = kindRaw?.trim().toLowerCase() as CreativeWorkspaceSourceKind;
  if (!SOURCE_KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid creative workspace kind" }, { status: 400 });
  }

  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const savedKeys = kind === "other-memos" ? null : SAVED_KEYS_BY_PROMPT_KIND[kind];

  if (!userId) {
    return NextResponse.json(
      {
        ticker: sym,
        sourceInventory: [],
        totalChars: 0,
        hasSubstantiveText: false,
        currentFingerprint: "",
        cacheFingerprint: null,
        cacheStale: true,
        cacheUpdatedAt: null,
        cachedMarkdown: null,
        anthropicConfigured: false,
        openaiConfigured: false,
        geminiConfigured: false,
        deepseekConfigured: false,
        deepseekDefaultModel: "",
        needsSignIn: true,
      },
      { status: 200 }
    );
  }

  const bundled = await gatherCreativeWorkspaceSources(kind, sym, undefined, userId, {
    useRetrieval: false,
    inventoryOnly: true,
  });
  const fp = bundled.sourceFingerprint;
  const meta =
    savedKeys && userId ? parseMeta(await readSavedContent(sym, savedKeys.meta, userId)) : null;
  const cached =
    savedKeys && userId ? ((await readSavedContent(sym, savedKeys.content, userId)) ?? "") : "";
  const llmAuth = await getAuthenticatedLlmContext();
  const kb = llmAuth.ok ? llmAuth.ctx.bundle : {};

  const sourceInventory = bundled.parts.map((p) => ({
    label: p.label,
    key: p.key,
    charsInitial: p.charsInitial,
    truncated: p.truncated,
    isBinaryPlaceholder: p.content.startsWith("[Binary"),
  }));
  const totalChars = bundled.parts.reduce((s, p) => s + p.charsInitial, 0);

  return NextResponse.json({
    ticker: sym,
    sourceInventory,
    totalChars,
    hasSubstantiveText: bundled.hasSubstantiveText,
    currentFingerprint: fp,
    cacheFingerprint: meta?.fingerprint ?? null,
    cacheStale: meta ? meta.fingerprint !== fp : true,
    cacheUpdatedAt: meta?.updatedAt ?? null,
    cachedMarkdown: cached.trim().length > 0 ? cached : null,
    anthropicConfigured: isProviderConfigured("claude", kb),
    openaiConfigured: isProviderConfigured("openai", kb),
    geminiConfigured: isProviderConfigured("gemini", kb),
    deepseekConfigured: isProviderConfigured("deepseek", kb),
    deepseekDefaultModel: getDeepSeekModel(),
    needsSignIn: false,
  });
}
