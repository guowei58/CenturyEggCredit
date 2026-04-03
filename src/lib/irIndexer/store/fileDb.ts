import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";
import type { IrAsset, IrIngestionJob, IrPage, IrSection, IrSource, IndexedIrSummary, IrAssetType } from "../types";
import { nowIso, stableId } from "../utils";

const DB_REL_PATH = "IR Indexer/db.json";

type DbState = {
  sources: IrSource[];
  pages: IrPage[];
  sections: IrSection[];
  assets: IrAsset[];
  jobs: IrIngestionJob[];
};

function emptyState(): DbState {
  return { sources: [], pages: [], sections: [], assets: [], jobs: [] };
}

async function loadDb(userId: string, ticker: string): Promise<DbState> {
  const safe = sanitizeTicker(ticker);
  if (!safe) return emptyState();
  const raw = await workspaceReadUtf8(userId, safe, DB_REL_PATH);
  if (!raw) return emptyState();
  try {
    const data = JSON.parse(raw) as DbState;
    if (!data || typeof data !== "object") return emptyState();
    return {
      sources: Array.isArray(data.sources) ? data.sources : [],
      pages: Array.isArray(data.pages) ? data.pages : [],
      sections: Array.isArray(data.sections) ? data.sections : [],
      assets: Array.isArray(data.assets) ? data.assets : [],
      jobs: Array.isArray(data.jobs) ? data.jobs : [],
    };
  } catch {
    return emptyState();
  }
}

async function saveDb(userId: string, ticker: string, state: DbState): Promise<void> {
  const safe = sanitizeTicker(ticker);
  if (!safe) return;
  await workspaceWriteUtf8(userId, safe, DB_REL_PATH, JSON.stringify(state, null, 2));
}

export function computeSourceId(rootUrl: string): string {
  return stableId(["ir_source", rootUrl.trim().toLowerCase()]);
}

export function createJobId(irSourceId: string): string {
  return stableId(["ir_job", irSourceId, nowIso(), String(Math.random())]);
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) return [...arr, item];
  const next = [...arr];
  next[i] = item;
  return next;
}

export async function upsertSource(userId: string, ticker: string, src: IrSource): Promise<void> {
  const db = await loadDb(userId, ticker);
  db.sources = upsertById(db.sources, src);
  await saveDb(userId, ticker, db);
}

export async function upsertJob(userId: string, ticker: string, job: IrIngestionJob): Promise<void> {
  const db = await loadDb(userId, ticker);
  db.jobs = upsertById(db.jobs, job);
  await saveDb(userId, ticker, db);
}

export async function replaceSourceData(params: {
  userId: string;
  ticker: string;
  irSourceId: string;
  pages: IrPage[];
  sections: IrSection[];
  assets: IrAsset[];
}): Promise<void> {
  const db = await loadDb(params.userId, params.ticker);
  db.pages = db.pages.filter((p) => p.ir_source_id !== params.irSourceId).concat(params.pages);
  const pageIds = new Set(params.pages.map((p) => p.id));
  db.sections = db.sections.filter((s) => !pageIds.has(s.ir_page_id)).concat(params.sections);
  db.assets = db.assets.filter((a) => a.ir_source_id !== params.irSourceId).concat(params.assets);
  await saveDb(params.userId, params.ticker, db);
}

export async function getSource(userId: string, ticker: string, id: string): Promise<IrSource | null> {
  const db = await loadDb(userId, ticker);
  return db.sources.find((s) => s.id === id) ?? null;
}

export async function getLatestJobForSource(
  userId: string,
  ticker: string,
  irSourceId: string
): Promise<IrIngestionJob | null> {
  const db = await loadDb(userId, ticker);
  const jobs = db.jobs
    .filter((j) => j.ir_source_id === irSourceId)
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  return jobs[0] ?? null;
}

export async function getSectionsForSource(
  userId: string,
  ticker: string,
  irSourceId: string
): Promise<Array<IrSection & { page: IrPage }>> {
  const db = await loadDb(userId, ticker);
  const pages = db.pages.filter((p) => p.ir_source_id === irSourceId);
  const pagesById = new Map(pages.map((p) => [p.id, p] as const));
  const sections = db.sections.filter((s) => pagesById.has(s.ir_page_id));
  return sections
    .map((s) => ({ ...s, page: pagesById.get(s.ir_page_id)! }))
    .sort(
      (a, b) =>
        a.page.depth - b.page.depth ||
        a.page.fetched_at.localeCompare(b.page.fetched_at) ||
        a.order_index - b.order_index
    );
}

export async function getAssetsForSource(params: {
  userId: string;
  ticker: string;
  irSourceId: string;
  type?: IrAssetType;
}): Promise<IrAsset[]> {
  const db = await loadDb(params.userId, params.ticker);
  const all = db.assets.filter((a) => a.ir_source_id === params.irSourceId);
  const filtered = params.type ? all.filter((a) => a.asset_type === params.type) : all;
  return filtered.sort(
    (a, b) =>
      (b.published_at ?? "").localeCompare(a.published_at ?? "") || (a.title ?? "").localeCompare(b.title ?? "")
  );
}

export async function getSummary(
  userId: string,
  ticker: string,
  irSourceId: string
): Promise<IndexedIrSummary | null> {
  const db = await loadDb(userId, ticker);
  const source = db.sources.find((s) => s.id === irSourceId);
  if (!source) return null;
  const pages = db.pages.filter((p) => p.ir_source_id === irSourceId);
  const assets = db.assets.filter((a) => a.ir_source_id === irSourceId);
  const assetsByType: Record<IrAssetType, number> = {
    pdf: 0,
    sec_filing: 0,
    press_release: 0,
    presentation: 0,
    transcript: 0,
    webcast: 0,
    annual_report: 0,
    quarterly_report: 0,
    governance: 0,
    event: 0,
    html_page: 0,
    other: 0,
  };
  for (const a of assets) {
    assetsByType[a.asset_type] = (assetsByType[a.asset_type] ?? 0) + 1;
  }
  return {
    source,
    pagesIndexed: pages.length,
    assetsFound: assets.length,
    assetsByType,
  };
}
