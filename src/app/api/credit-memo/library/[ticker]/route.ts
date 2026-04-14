import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  addLibraryDeck,
  addLibraryMemo,
  deleteLibraryEntry,
  readLibraryDeckBuffer,
  readLibraryIndex,
  readLibraryMemoContent,
} from "@/lib/ai-memo-deck-library";
import { creditMemoPrimaryModelId, resolveCreditMemoModels } from "@/lib/ai-model-from-request";
import { sanitizeClientModelId } from "@/lib/ai-model-options";
import { normalizeAiProvider } from "@/lib/ai-provider";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function safeFilenamePart(s: string): string {
  return s.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "deck";
}

/**
 * GET — list entries, or ?memoId= for markdown JSON, or ?deckId= for .pptx download.
 * POST JSON { action: "addMemo", title, markdown, variant?, provider?, llmModel? } — add memo.
 * POST multipart: action=addDeck, title=, file=.pptx — add deck.
 * DELETE ?id= — remove entry and file.
 */
export async function GET(request: Request, { params }: { params: { ticker: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = params.ticker;
  if (!sanitizeTicker(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const url = new URL(request.url);
  const memoId = url.searchParams.get("memoId")?.trim() ?? "";
  const deckId = url.searchParams.get("deckId")?.trim() ?? "";

  if (memoId) {
    const markdown = await readLibraryMemoContent(userId, ticker, memoId);
    if (markdown == null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ markdown });
  }

  if (deckId) {
    const buf = await readLibraryDeckBuffer(userId, ticker, deckId);
    if (!buf) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const entries = await readLibraryIndex(userId, ticker);
    const e = entries.find((x) => x.id === deckId && x.kind === "deck");
    const base =
      e && e.kind === "deck"
        ? safeFilenamePart(e.title)
        : deckId;
    const filename = `${sanitizeTicker(ticker)}_${base}.pptx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const entries = await readLibraryIndex(userId, ticker);
  return NextResponse.json({ entries });
}

export async function POST(request: Request, { params }: { params: { ticker: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = params.ticker;
  if (!sanitizeTicker(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const ct = request.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    let fd: FormData;
    try {
      fd = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    const action = String(fd.get("action") ?? "");
    if (action !== "addDeck") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const title = String(fd.get("title") ?? "").trim() || "Credit deck";
    const deckProviderRaw = String(fd.get("provider") ?? "").trim().slice(0, 40);
    const deckProviderNorm = normalizeAiProvider(deckProviderRaw);
    const deckProvider = deckProviderRaw || null;
    let deckLlm = sanitizeClientModelId(String(fd.get("llmModel") ?? ""));
    if (!deckLlm && deckProviderNorm) {
      deckLlm = creditMemoPrimaryModelId(deckProviderNorm, resolveCreditMemoModels({}));
    }
    const file = fd.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const ab = await file.arrayBuffer();
    const pptx = Buffer.from(ab);
    const r = await addLibraryDeck(userId, ticker, {
      title,
      pptx,
      provider: deckProvider,
      llmModel: deckLlm ?? null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: r.id });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as {
    action?: string;
    title?: string;
    markdown?: string;
    variant?: string | null;
    provider?: string | null;
    llmModel?: string | null;
  };
  if (b.action !== "addMemo") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const markdown = typeof b.markdown === "string" ? b.markdown : "";
  if (!markdown.trim()) {
    return NextResponse.json({ error: "markdown required" }, { status: 400 });
  }
  const variant = typeof b.variant === "string" ? b.variant : b.variant === null ? null : undefined;
  const provider = typeof b.provider === "string" ? b.provider : b.provider === null ? null : undefined;
  const providerNorm = normalizeAiProvider(typeof b.provider === "string" ? b.provider.trim() : undefined);
  let llmModel: string | undefined =
    typeof b.llmModel === "string" && b.llmModel.trim() ? sanitizeClientModelId(b.llmModel) : undefined;
  if (!llmModel && providerNorm) {
    llmModel = creditMemoPrimaryModelId(providerNorm, resolveCreditMemoModels({}));
  }
  const r = await addLibraryMemo(userId, ticker, {
    title: title || "Credit memo",
    markdown,
    variant,
    provider,
    llmModel,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(request: Request, { params }: { params: { ticker: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = params.ticker;
  if (!sanitizeTicker(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const r = await deleteLibraryEntry(userId, ticker, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "Not found" ? 404 : 400 });
  return NextResponse.json({ ok: true });
}
