/**
 * Server-only: bundle user-owned server data into one or more ZIP parts (Postgres).
 * Each part stays under a max uncompressed payload size so JSZip memory stays bounded per request.
 */

import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { getWatchlistTickers } from "@/lib/user-workspace-store";

function tabFilenameForDataKey(dataKey: string): string {
  if (Object.prototype.hasOwnProperty.call(SAVED_DATA_FILES, dataKey)) {
    return SAVED_DATA_FILES[dataKey as keyof typeof SAVED_DATA_FILES];
  }
  const safe = dataKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}.txt`;
}

function safeZipPathSegment(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/\.\./g, "_").trim() || "file";
}

/** Hard ceiling per ZIP part (uncompressed sum of file payloads, excluding small README). */
export const EXPORT_ABSOLUTE_MAX_PART_BYTES = 4096 * 1024 * 1024;

/**
 * Default per-part uncompressed budget: conservative so `JSZip` (in-memory) does not blow the Node heap
 * on typical dev machines. More parts = more downloads, but stable. Raise with EXPORT_MAX_UNCOMPRESSED_MB
 * (e.g. 1024) on a host with plenty of RAM.
 */
const DEFAULT_MAX_PART_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

/**
 * Max uncompressed bytes per ZIP part. Env `EXPORT_MAX_UNCOMPRESSED_MB` overrides default (capped at 4096).
 */
export function maxExportUncompressedBytesPerPart(): number {
  const raw = process.env.EXPORT_MAX_UNCOMPRESSED_MB?.trim();
  if (!raw) return DEFAULT_MAX_PART_UNCOMPRESSED_BYTES;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) return DEFAULT_MAX_PART_UNCOMPRESSED_BYTES;
  return Math.min(Math.floor(mb * 1024 * 1024), EXPORT_ABSOLUTE_MAX_PART_BYTES);
}

export type PlannedExportEntry = {
  /** Uncompressed payload size (bytes). */
  size: number;
  /** Path inside `century-egg-export/` in the ZIP. */
  zipRelPath: string;
  load: () => Promise<Buffer>;
};

const README_BODY = [
  "account/",
  "  preferences.json     — UI preferences, memo drafts, and related JSON",
  "  ai-chat-state.json   — AI Chat (sidebar) conversation state",
  "  watchlist.txt        — Watchlist tickers, one per line",
  "",
  "tickers/<SYMBOL>/",
  "  saved-tabs/          — Research tab text stored on the server (.txt, .md, .html, .json)",
  "  saved-documents/     — Files saved under Saved Documents (PDF, Excel, etc.)",
  "  workspace/           — Excel exports, IR indexer DBs, memo/deck outputs, and other API files",
  "",
  "The ticker folder __global__ holds account-wide workspace data (e.g. templates, Reddit registry).",
  "",
  "This export includes server-stored data only. Local browser-only content is not included.",
].join("\n");

/**
 * Ordered list of exportable files with sizes (cheap) and lazy loaders (per part).
 */
export async function listPlannedExportEntries(userId: string): Promise<PlannedExportEntry[]> {
  const out: PlannedExportEntry[] = [];

  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  if (prefs?.payload) {
    const snapshot = prefs.payload;
    const buf = Buffer.from(snapshot, "utf8");
    out.push({
      size: buf.length,
      zipRelPath: "account/preferences.json",
      load: async () => Buffer.from(snapshot, "utf8"),
    });
  }

  const ai = await prisma.userAiChatState.findUnique({ where: { userId } });
  if (ai?.payload) {
    const snapshot = ai.payload;
    const buf = Buffer.from(snapshot, "utf8");
    out.push({
      size: buf.length,
      zipRelPath: "account/ai-chat-state.json",
      load: async () => Buffer.from(snapshot, "utf8"),
    });
  }

  const watchlist = await getWatchlistTickers(userId);
  const wlText = watchlist.join("\n") + (watchlist.length ? "\n" : "");
  const wlBuf = Buffer.from(wlText, "utf8");
  out.push({
    size: wlBuf.length,
    zipRelPath: "account/watchlist.txt",
    load: async () => Buffer.from(wlText, "utf8"),
  });

  const tabSizes = await prisma.$queryRaw<Array<{ ticker: string; data_key: string; len: bigint }>>`
    SELECT ticker, data_key, octet_length(content::text) AS len
    FROM user_ticker_documents
    WHERE user_id = ${userId} AND length(trim(content)) > 0
    ORDER BY ticker ASC, data_key ASC
  `;

  for (const row of tabSizes) {
    const ticker = row.ticker;
    const dataKey = row.data_key;
    const size = Number(row.len);
    const fn = tabFilenameForDataKey(dataKey);
    const zp = `tickers/${safeZipPathSegment(ticker)}/saved-tabs/${safeZipPathSegment(fn)}`;
    out.push({
      size,
      zipRelPath: zp,
      load: async () => {
        const doc = await prisma.userTickerDocument.findUnique({
          where: { userId_ticker_dataKey: { userId, ticker, dataKey } },
          select: { content: true },
        });
        return Buffer.from(doc?.content ?? "", "utf8");
      },
    });
  }

  const savedRows = await prisma.userSavedDocument.findMany({
    where: { userId },
    select: { ticker: true, filename: true, bytes: true },
    orderBy: [{ ticker: "asc" }, { filename: "asc" }],
  });

  for (const r of savedRows) {
    const fn = safeZipPathSegment(r.filename);
    const zp = `tickers/${safeZipPathSegment(r.ticker)}/saved-documents/${fn}`;
    out.push({
      size: r.bytes,
      zipRelPath: zp,
      load: async () => {
        const row = await prisma.userSavedDocument.findUnique({
          where: {
            userId_ticker_filename: { userId, ticker: r.ticker, filename: r.filename },
          },
          select: { body: true },
        });
        return row?.body ? Buffer.from(row.body) : Buffer.alloc(0);
      },
    });
  }

  const wsSizes = await prisma.$queryRaw<Array<{ ticker: string; path: string; len: bigint }>>`
    SELECT ticker, path, octet_length(body) AS len
    FROM user_ticker_workspace_files
    WHERE user_id = ${userId}
    ORDER BY ticker ASC, path ASC
  `;

  for (const row of wsSizes) {
    const rel = row.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.includes("..")) continue;
    const size = Number(row.len);
    const zp = `tickers/${safeZipPathSegment(row.ticker)}/workspace/${rel}`;
    const t = row.ticker;
    const p = row.path;
    out.push({
      size,
      zipRelPath: zp,
      load: async () => {
        const row2 = await prisma.userTickerWorkspaceFile.findUnique({
          where: { userId_ticker_path: { userId, ticker: t, path: p } },
          select: { body: true },
        });
        return row2?.body ? Buffer.from(row2.body) : Buffer.alloc(0);
      },
    });
  }

  return out;
}

/**
 * Greedy partition: each part's entries sum to <= maxBytes, except a single file larger than maxBytes
 * becomes its own part (may exceed max — unavoidable without splitting binaries).
 */
export function partitionExportEntries(entries: PlannedExportEntry[], maxBytes: number): PlannedExportEntry[][] {
  if (maxBytes < 1) return [entries];
  const parts: PlannedExportEntry[][] = [];
  let current: PlannedExportEntry[] = [];
  let sum = 0;

  for (const e of entries) {
    if (e.size > maxBytes) {
      if (current.length) {
        parts.push(current);
        current = [];
        sum = 0;
      }
      parts.push([e]);
      continue;
    }
    if (sum + e.size > maxBytes && current.length > 0) {
      parts.push(current);
      current = [];
      sum = 0;
    }
    current.push(e);
    sum += e.size;
  }
  if (current.length) parts.push(current);

  return parts.length > 0 ? parts : [[]];
}

function readmeForPart(generatedAt: string, part: number, totalParts: number, oversizedNote: boolean): string {
  const header =
    totalParts > 1
      ? [
          "Century Egg Credit — full data export",
          `Generated (UTC): ${generatedAt}`,
          `This archive is part ${part} of ${totalParts}. Download every part and unzip each; together they contain your full export.`,
          oversizedNote
            ? "Note: At least one file alone exceeded the per-part size limit and occupies its own part (that ZIP may be larger than the configured part cap)."
            : "",
          "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Century Egg Credit — full data export",
          `Generated (UTC): ${generatedAt}`,
          oversizedNote
            ? "Note: At least one file alone exceeded the per-part size limit and occupies its own part."
            : "",
          "",
        ]
          .filter(Boolean)
          .join("\n");

  return `${header}${README_BODY}\n`;
}

export type UserExportPartResult = {
  buffer: Buffer;
  part: number;
  totalParts: number;
  filename: string;
};

export type UserExportManifest = {
  totalParts: number;
  parts: Array<{ part: number; filename: string }>;
};

/** Lightweight JSON for the client (no ZIP build). Filenames match the next GET ?part= responses. */
export async function getUserExportManifest(userId: string): Promise<UserExportManifest> {
  const maxBytes = maxExportUncompressedBytesPerPart();
  const entries = await listPlannedExportEntries(userId);
  const partitions = partitionExportEntries(entries, maxBytes);
  const totalParts = partitions.length;
  const day = new Date().toISOString().slice(0, 10);
  const parts = partitions.map((_, i) => {
    const part = i + 1;
    const filename =
      totalParts > 1
        ? `century-egg-export-${day}-part${part}of${totalParts}.zip`
        : `century-egg-export-${day}.zip`;
    return { part, filename };
  });
  return { totalParts, parts };
}

/**
 * Build one ZIP part (1-based index). Recomputes plan and partition each call (stateless, correct if data changes mid-export).
 */
export async function buildUserExportPartZip(userId: string, part1Based: number): Promise<UserExportPartResult> {
  const maxBytes = maxExportUncompressedBytesPerPart();
  const entries = await listPlannedExportEntries(userId);
  const partitions = partitionExportEntries(entries, maxBytes);
  const totalParts = partitions.length;
  const part = Math.floor(part1Based);
  if (part < 1 || part > totalParts) {
    throw new Error(`Invalid part ${part1Based} (total parts: ${totalParts})`);
  }

  const slice = partitions[part - 1] ?? [];
  const generatedAt = new Date().toISOString();
  const oversizedNote = entries.some((e) => e.size > maxBytes);

  const zip = new JSZip();
  const root = zip.folder("century-egg-export");
  if (!root) {
    throw new Error("Failed to create zip root");
  }

  root.file("README.txt", readmeForPart(generatedAt, part, totalParts, oversizedNote));

  for (const e of slice) {
    const body = await e.load();
    root.file(e.zipRelPath, body);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const day = generatedAt.slice(0, 10);
  const filename =
    totalParts > 1
      ? `century-egg-export-${day}-part${part}of${totalParts}.zip`
      : `century-egg-export-${day}.zip`;

  return { buffer, part, totalParts, filename };
}
