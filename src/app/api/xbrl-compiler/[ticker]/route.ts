import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { listSavedDocuments } from "@/lib/saved-documents";
import {
  getUserSavedDocumentBody,
  readUserTickerDocument,
  writeUserTickerDocument,
} from "@/lib/user-workspace-store";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COMPILER_DIR = path.resolve(process.cwd(), "xbrl-compiler");
const XBRL_XLSX_RE = /SEC-XBRL-financials_as-presented/i;

async function runPython(
  inputDir: string,
  outputDir: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const args = [
      path.join(COMPILER_DIR, "main.py"),
      "--input", inputDir,
      "--output", outputDir,
    ];

    // AI Phase 3 is gated by ENABLE_AI_MATCHING in xbrl-compiler/main.py (off by default).
    // Do not pass --ai-provider even when API keys exist unless that flag is turned on.

    const pythonBin = process.env.PYTHON_PATH?.trim() || process.env.PYTHON_CMD?.trim() || "python";

    const proc = spawn(pythonBin, args, {
      cwd: COMPILER_DIR,
      env: { ...process.env, PYTHONPATH: COMPILER_DIR },
      timeout: 280_000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr || `Exit code ${code}` });
        return;
      }
      const trimmed = stdout.trim();
      try {
        // Pipeline prints one JSON object; parse the full stdout (brace-depth scanning breaks on "{" inside strings).
        resolve(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start >= 0 && end > start) {
          try {
            resolve(JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>);
            return;
          } catch {
            /* fall through */
          }
        }
        resolve({ ok: false, error: `Parse error: ${trimmed.slice(-500)}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: `Spawn: ${err.message}` });
    });
  });
}

async function materializeFiles(
  userId: string,
  ticker: string,
  selectedFiles?: string[],
): Promise<{ ok: true; dir: string; count: number } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };

  const items = await listSavedDocuments(userId, sym);
  if (!items) return { ok: false, error: "Could not list documents" };

  const xbrl = items.filter((it) => {
    if (!XBRL_XLSX_RE.test(it.filename)) return false;
    return !selectedFiles?.length || selectedFiles.includes(it.filename);
  });

  if (!xbrl.length) {
    return {
      ok: false,
      error: `No XBRL workbooks found for ${sym}. Bulk-save on Historical Financial Statements (Period Financials HTML face) or SEC XBRL Financials first.`,
    };
  }

  const dir = path.join(os.tmpdir(), `ceg-xbrl-${sym}-${randomBytes(6).toString("hex")}`);
  await fs.mkdir(dir, { recursive: true });

  let n = 0;
  for (const it of xbrl) {
    const body = await getUserSavedDocumentBody(userId, sym, it.filename);
    if (!body) continue;
    await fs.writeFile(path.join(dir, it.filename), body);
    n++;
  }

  if (!n) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: "Could not read file bodies" };
  }
  return { ok: true, dir, count: n };
}

async function cleanup(dir: string) {
  try {
    const r = path.resolve(dir);
    if (r.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      await fs.rm(r, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
}

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const items = await listSavedDocuments(userId, sym);
  if (!items) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const xbrlFiles = items
    .filter((it) => XBRL_XLSX_RE.test(it.filename))
    .map((it) => ({
      filename: it.filename,
      title: it.title,
      savedAt: it.savedAtIso,
      contentType: it.contentType,
    }));

  const allFiles = items.map((it) => ({
    filename: it.filename,
    title: it.title,
    savedAt: it.savedAtIso,
    contentType: it.contentType,
    isXbrl: XBRL_XLSX_RE.test(it.filename),
  }));

  let lastCompiledResult: unknown = null;
  const raw = await readUserTickerDocument(userId, sym, "xbrl-deterministic-compiler-result");
  if (raw) {
    try {
      lastCompiledResult = JSON.parse(raw) as unknown;
    } catch {
      lastCompiledResult = null;
    }
  }

  return NextResponse.json({
    ticker: sym,
    xbrlFileCount: xbrlFiles.length,
    xbrlFiles,
    allFiles,
    lastCompiledResult,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  let body: { selectedFiles?: string[] } = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  const mat = await materializeFiles(userId, sym, body.selectedFiles);
  if (!mat.ok) return NextResponse.json({ ok: false, error: mat.error }, { status: 400 });

  const outDir = path.join(os.tmpdir(), "xbrl-out", sym, Date.now().toString());
  await fs.mkdir(outDir, { recursive: true });

  try {
    const result = await runPython(mat.dir, outDir);
    const merged = { ...result, inputFileCount: mat.count } as Record<string, unknown>;
    const ok = (result as { ok?: boolean }).ok === true;
    const models = merged.models as Record<string, unknown> | undefined;
    const modelKeys =
      models && typeof models === "object" ? Object.keys(models).filter((k) => models[k]) : [];
    if (ok && modelKeys.length === 0) {
      const built = (merged.statements_built as string[] | undefined)?.join(", ") ?? "none";
      return NextResponse.json(
        {
          ok: false,
          error: `Compiler finished but produced no statement grids (built: ${built}). Check workbook sheet names (Income Statement, Balance Sheet, Cash Flow) and period columns.`,
          inputFileCount: mat.count,
          compiler_schema_version: merged.compiler_schema_version,
        },
        { status: 500 }
      );
    }
    if (ok) {
      const saved = await writeUserTickerDocument(
        userId,
        sym,
        "xbrl-deterministic-compiler-result",
        JSON.stringify(merged),
      );
      if (!saved.ok) {
        console.warn("[xbrl-compiler] Could not persist last compiled result:", saved.error);
      }
    }
    return NextResponse.json(merged, { status: ok ? 200 : 500 });
  } finally {
    await cleanup(mat.dir);
  }
}
