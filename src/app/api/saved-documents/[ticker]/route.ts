import { NextResponse } from "next/server";
import path from "path";
import { auth } from "@/auth";
import {
  deleteSavedDocument,
  importTickerFilesIntoSavedDocuments,
  listSavedDocuments,
  reconcileSavedDocuments,
  saveDocumentFromUrl,
} from "@/lib/saved-documents";
import { getUserSavedDocumentBody } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";

function contentTypeForFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".md":
    case ".log":
    case ".csv":
    case ".tsv":
    case ".json":
    case ".xml":
    case ".yaml":
    case ".yml":
    case ".ini":
    case ".cfg":
    case ".conf":
      return "text/plain; charset=utf-8";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}

/**
 * GET  /api/saved-documents/[ticker]  -> list saved items (Postgres, signed-in user)
 * GET  ?file= — download one stored document
 * GET  ?reconcile=1 — no-op compatibility (same as list)
 * POST { url } — fetch URL, store PDF in Postgres
 * POST { action: "import-ticker-files" } — legacy no-op; returns current list
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  if (file) {
    if (file.includes("/") || file.includes("\\") || file.includes("..")) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }
    const buf = await getUserSavedDocumentBody(userId, ticker, file);
    if (!buf) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": contentTypeForFilename(file),
        "Content-Disposition": `inline; filename="${file}"`,
      },
    });
  }
  const reconcile = url.searchParams.get("reconcile") === "1";
  const items = reconcile
    ? await reconcileSavedDocuments(userId, ticker)
    : await listSavedDocuments(userId, ticker);
  if (!items) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  return NextResponse.json({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { url?: unknown; action?: unknown };

  if (b.action === "import-ticker-files") {
    const items = await importTickerFilesIntoSavedDocuments(userId, ticker);
    if (!items) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    return NextResponse.json({ ok: true, items });
  }

  const url = typeof b.url === "string" ? b.url : "";
  if (!url.trim()) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const result = await saveDocumentFromUrl(userId, ticker, url);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, item: result.item });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected save failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { filename?: unknown };
  const filename = typeof b.filename === "string" ? b.filename : "";
  if (!filename.trim()) {
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });
  }

  const result = await deleteSavedDocument(userId, ticker, filename);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
