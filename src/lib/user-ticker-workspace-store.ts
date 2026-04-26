/**
 * All user-owned files that previously lived under data/ — X, excel, credit memo state, etc.
 */

import { randomBytes } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { prisma } from "@/lib/prisma";
import { QuotaExceededError, withTransientPgRetry } from "@/lib/pg-connection-retry";
import { isAiChatOreoTxtOrHtmlFilename, SAVED_DATA_FILES, sanitizeTicker } from "@/lib/saved-ticker-data";
import { assertUserStorageAllowsNetDelta } from "@/lib/user-storage-quota";
import { MAX_WORKSPACE_FILE_BYTES } from "@/lib/user-ticker-workspace-constants";
import {
  listAllUserSavedDocumentsBodiesForIngest,
  listUserTickerDocuments,
} from "@/lib/user-workspace-store";

const MAX_REL_PATH_LEN = 768;

export function normalizeWorkspaceRelPath(raw: string): string | null {
  const s = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!s || s.length > MAX_REL_PATH_LEN) return null;
  if (s.includes("..")) return null;
  const parts = s.split("/").filter(Boolean);
  if (parts.some((p) => p === ".")) return null;
  return parts.join("/");
}

export async function workspaceReadFile(
  userId: string,
  ticker: string,
  relPath: string
): Promise<Buffer | null> {
  const sym = sanitizeTicker(ticker);
  const np = normalizeWorkspaceRelPath(relPath);
  if (!sym || !np) return null;
  const row = await withTransientPgRetry("workspaceReadFile", () =>
    prisma.userTickerWorkspaceFile.findUnique({
      where: { userId_ticker_path: { userId, ticker: sym, path: np } },
      select: { body: true },
    })
  );
  return row?.body ? Buffer.from(row.body) : null;
}

export async function workspaceWriteFile(
  userId: string,
  ticker: string,
  relPath: string,
  body: Buffer
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  const np = normalizeWorkspaceRelPath(relPath);
  if (!sym || !np) return { ok: false, error: "Invalid path" };
  if (body.length > MAX_WORKSPACE_FILE_BYTES) {
    return { ok: false, error: "File too large" };
  }
  try {
    /** Extra retries: long-running routes (e.g. KPI embeddings) often idle the pool for minutes before a large write. */
    await withTransientPgRetry(
      "workspaceWriteFile",
      async () => {
        const existing = await prisma.userTickerWorkspaceFile.findUnique({
          where: { userId_ticker_path: { userId, ticker: sym, path: np } },
          select: { body: true },
        });
        const oldLen = existing?.body ? Buffer.from(existing.body).length : 0;
        const delta = body.length - oldLen;
        const quota = await assertUserStorageAllowsNetDelta(userId, delta);
        if (!quota.ok) throw new QuotaExceededError(quota.error);
        await prisma.userTickerWorkspaceFile.upsert({
          where: { userId_ticker_path: { userId, ticker: sym, path: np } },
          create: { userId, ticker: sym, path: np, body: new Uint8Array(body) },
          update: { body: new Uint8Array(body) },
        });
      },
      { retries: 10, baseDelayMs: 500 }
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof QuotaExceededError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Write failed" };
  }
}

export async function workspaceDeleteFile(userId: string, ticker: string, relPath: string): Promise<void> {
  const sym = sanitizeTicker(ticker);
  const np = normalizeWorkspaceRelPath(relPath);
  if (!sym || !np) return;
  await prisma.userTickerWorkspaceFile.deleteMany({
    where: { userId, ticker: sym, path: np },
  });
}

/** Delete paths equal to prefix or under prefix/ */
export async function workspaceDeletePrefix(userId: string, ticker: string, prefixRaw: string): Promise<void> {
  const sym = sanitizeTicker(ticker);
  const prefix = normalizeWorkspaceRelPath(prefixRaw.replace(/\/+$/, ""));
  if (!sym || !prefix) return;
  await prisma.userTickerWorkspaceFile.deleteMany({
    where: {
      userId,
      ticker: sym,
      OR: [{ path: prefix }, { path: { startsWith: `${prefix}/` } }],
    },
  });
}

export async function workspaceFileCount(userId: string, ticker: string): Promise<number> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return 0;
  return prisma.userTickerWorkspaceFile.count({ where: { userId, ticker: sym } });
}

export async function workspaceListRelativePaths(userId: string, ticker: string): Promise<string[]> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  const rows = await prisma.userTickerWorkspaceFile.findMany({
    where: { userId, ticker: sym },
    select: { path: true },
    orderBy: { path: "asc" },
  });
  return rows.map((r) => r.path);
}

/**
 * AI Chat OREO only: `.txt` / `.html` / `.htm` workspace files (one query — avoids materializing binaries).
 */
export async function workspaceFetchTxtHtmlFilesForAi(
  userId: string,
  ticker: string
): Promise<Array<{ path: string; text: string }>> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  const extPattern = String.raw`\.(txt|html|htm)$`;
  const rows = await prisma.$queryRaw<Array<{ path: string; body: Buffer }>>`
    SELECT path, body
    FROM user_ticker_workspace_files
    WHERE user_id = ${userId}
      AND ticker = ${sym}
      AND path ~* ${extPattern}
    ORDER BY path ASC
  `;
  const out: Array<{ path: string; text: string }> = [];
  for (const row of rows) {
    if (!isAiChatOreoTxtOrHtmlFilename(row.path)) continue;
    const text = Buffer.from(row.body).toString("utf8");
    out.push({ path: row.path.replace(/\\/g, "/"), text });
  }
  return out;
}

export async function workspaceReadUtf8(userId: string, ticker: string, relPath: string): Promise<string | null> {
  const buf = await workspaceReadFile(userId, ticker, relPath);
  if (!buf) return null;
  return buf.toString("utf8");
}

export async function workspaceWriteUtf8(
  userId: string,
  ticker: string,
  relPath: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return workspaceWriteFile(userId, ticker, relPath, Buffer.from(text, "utf8"));
}

export async function workspaceAppendUtf8(
  userId: string,
  ticker: string,
  relPath: string,
  chunk: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prev = (await workspaceReadUtf8(userId, ticker, relPath)) ?? "";
  return workspaceWriteUtf8(userId, ticker, relPath, prev + chunk);
}

/** Subfolder under materialized root for PDFs / binaries from Saved Documents (Postgres). */
export const USER_SAVED_DOCUMENTS_MATERIALIZE_DIR = "__ceg_user_saved_documents__";

/**
 * Materialize `UserTickerWorkspaceFile` plus Postgres tab text (`UserTickerDocument`) and
 * Saved Documents (`UserSavedDocument`) for credit memo / AI deck ingest and OREO workspace scans.
 */
export async function materializeUserWorkspaceToTempDir(userId: string, ticker: string): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) throw new Error("Invalid ticker");
  const rows = await prisma.userTickerWorkspaceFile.findMany({
    where: { userId, ticker: sym },
    select: { path: true, body: true },
  });
  const token = randomBytes(8).toString("hex");
  const base = path.join(os.tmpdir(), `ceg-ws-${userId.slice(0, 12)}-${sym}-${token}`);
  await fs.mkdir(base, { recursive: true });
  for (const row of rows) {
    const fp = path.join(base, ...row.path.split("/"));
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, Buffer.from(row.body));
  }

  const [tabDocs, savedBins] = await Promise.all([
    listUserTickerDocuments(userId, sym),
    listAllUserSavedDocumentsBodiesForIngest(userId, sym),
  ]);

  for (const doc of tabDocs) {
    if (!(doc.dataKey in SAVED_DATA_FILES)) continue;
    const fn = SAVED_DATA_FILES[doc.dataKey as keyof typeof SAVED_DATA_FILES];
    if (!fn || !doc.content?.trim()) continue;
    const fp = path.join(base, fn);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, doc.content, "utf8");
  }

  for (const { filename, body } of savedBins) {
    const fn = filename.trim();
    if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) continue;
    const fp = path.join(base, USER_SAVED_DOCUMENTS_MATERIALIZE_DIR, fn);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, body);
  }

  return base;
}

export async function rmTempWorkspaceDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function isOsTempMaterializedWorkspacePath(dir: string): boolean {
  const resolved = path.resolve(dir);
  const tmp = path.resolve(os.tmpdir());
  const base = path.basename(resolved);
  return resolved.startsWith(tmp + path.sep) && base.startsWith("ceg-ws-");
}
