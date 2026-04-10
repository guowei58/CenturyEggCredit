import { NextResponse } from "next/server";
import path from "path";
import { auth } from "@/auth";
import {
  deleteSavedDocument,
  importTickerFilesIntoSavedDocuments,
  listSavedDocuments,
  reconcileSavedDocuments,
  saveDocumentFromUrl,
  saveXbrlAsPresentedExcelToSavedDocuments,
} from "@/lib/saved-documents";
import { getUserSavedDocumentBody } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
 * POST multipart: action=save-xbrl-as-presented-xlsx, file=(.xlsx), filingForm, filingDate, accessionNumber — preferred (no base64 size blow-up)
 * POST JSON: { action: "save-xbrl-as-presented-xlsx", base64, filing } — legacy / small workbooks only
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
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let fd: FormData;
    try {
      fd = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
    }
    const action = fd.get("action");
    if (action === "save-xbrl-as-presented-xlsx") {
      const rawFile = fd.get("file");
      if (rawFile === null || typeof rawFile === "string") {
        return NextResponse.json({ error: "Missing spreadsheet file." }, { status: 400 });
      }
      const blob = rawFile as Blob;
      if (blob.size < 64) {
        return NextResponse.json({ error: "Spreadsheet file is empty or too small." }, { status: 400 });
      }
      const form = String(fd.get("filingForm") ?? "").trim();
      const filingDate = String(fd.get("filingDate") ?? "").trim();
      const accessionNumber = String(fd.get("accessionNumber") ?? "").trim();
      if (!form || !filingDate || !accessionNumber) {
        return NextResponse.json(
          { error: "Missing filing metadata (form, filing date, or accession number)." },
          { status: 400 }
        );
      }
      let buf: Buffer;
      try {
        buf = Buffer.from(await blob.arrayBuffer());
      } catch {
        return NextResponse.json({ error: "Could not read uploaded file." }, { status: 400 });
      }
      try {
        const result = await saveXbrlAsPresentedExcelToSavedDocuments(userId, ticker, { form, filingDate, accessionNumber }, buf);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ ok: true, item: result.item });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Save failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "Unknown multipart action." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { url?: unknown; action?: unknown; base64?: unknown; filing?: unknown };

  if (b.action === "save-xbrl-as-presented-xlsx") {
    const b64 = typeof b.base64 === "string" ? b.base64.trim() : "";
    const filing = b.filing as Record<string, unknown> | undefined;
    const form = typeof filing?.form === "string" ? filing.form.trim() : "";
    const filingDate = typeof filing?.filingDate === "string" ? filing.filingDate.trim() : "";
    const accessionNumber = typeof filing?.accessionNumber === "string" ? filing.accessionNumber.trim() : "";
    if (!b64 || !form || !filingDate || !accessionNumber) {
      return NextResponse.json(
        {
          error:
            "Missing spreadsheet or filing metadata. For large exports, use multipart upload (Save as Excel in the app uses that).",
        },
        { status: 400 }
      );
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid base64 payload." }, { status: 400 });
    }
    try {
      const result = await saveXbrlAsPresentedExcelToSavedDocuments(userId, ticker, { form, filingDate, accessionNumber }, buf);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, item: result.item });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

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
