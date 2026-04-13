import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { listSavedDocuments } from "@/lib/saved-documents";
import { getUserSavedDocumentBody } from "@/lib/user-workspace-store";
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

    const openaiKey = process.env.OPENAI_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (openaiKey) {
      args.push("--ai-provider", "openai", "--ai-api-key", openaiKey);
    } else if (deepseekKey) {
      args.push("--ai-provider", "deepseek", "--ai-api-key", deepseekKey);
    }

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
      try {
        let jsonStr = "";
        let depth = 0;
        let capturing = false;
        for (const line of stdout.trim().split("\n")) {
          if (!capturing && line.trim().startsWith("{")) capturing = true;
          if (capturing) {
            jsonStr += line + "\n";
            depth += (line.match(/{/g) || []).length;
            depth -= (line.match(/}/g) || []).length;
            if (depth <= 0) break;
          }
        }
        resolve(JSON.parse(jsonStr));
      } catch {
        resolve({ ok: false, error: `Parse error: ${stdout.slice(-500)}` });
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
    return { ok: false, error: `No XBRL workbooks found for ${sym}. Save statements via "SEC XBRL Financials" first.` };
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

  return NextResponse.json({ ticker: sym, xbrlFileCount: xbrlFiles.length, xbrlFiles, allFiles });
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
    return NextResponse.json(
      { ...result, inputFileCount: mat.count },
      { status: (result as { ok?: boolean }).ok ? 200 : 500 },
    );
  } finally {
    await cleanup(mat.dir);
  }
}
