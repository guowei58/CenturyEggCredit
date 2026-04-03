import type { IrAsset, IrIngestionJob, IrSource } from "./types";
import { crawlIrSite } from "./crawl/crawler";
import { enrichWithSec } from "./sec/secEnricher";
import {
  computeSourceId,
  createJobId,
  getLatestJobForSource,
  getSource,
  getSummary,
  replaceSourceData,
  upsertJob,
  upsertSource,
} from "./store/fileDb";
import { nowIso, stableId } from "./utils";

function ensureUrl(url: string): { ok: true; url: string } | { ok: false; error: string } {
  const u = (url ?? "").trim();
  if (!u) return { ok: false, error: "url is required" };
  try {
    const parsed = new URL(u);
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: "url must be http(s)" };
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "invalid url" };
  }
}

export async function submitIrIndexJob(params: {
  userId: string;
  ticker: string;
  url: string;
  forceReindex?: boolean;
}): Promise<
  | { ok: true; sourceId: string; jobId: string }
  | { ok: false; error: string }
> {
  const ticker = (params.ticker ?? "").trim().toUpperCase();
  if (!ticker) return { ok: false, error: "ticker is required" };

  const u = ensureUrl(params.url);
  if (!u.ok) return { ok: false, error: u.error };

  const rootUrl = (() => {
    const x = new URL(u.url);
    return `${x.protocol}//${x.host}/`;
  })();
  const sourceId = computeSourceId(`${ticker}|${rootUrl}`);

  const now = nowIso();
  const existing = await getSource(params.userId, ticker, sourceId);
  const src: IrSource = existing ?? {
    id: sourceId,
    ticker,
    root_url: rootUrl,
    company_name: null,
    cik: null,
    status: "queued",
    last_indexed_at: null,
    created_at: now,
    updated_at: now,
  };

  const latestJob = await getLatestJobForSource(params.userId, ticker, sourceId);
  if (latestJob && latestJob.status === "running" && !params.forceReindex) {
    return { ok: true, sourceId, jobId: latestJob.id };
  }

  const jobId = createJobId(sourceId);
  await upsertSource(params.userId, ticker, { ...src, status: "queued", updated_at: now });
  await upsertJob(params.userId, ticker, {
    id: jobId,
    ir_source_id: sourceId,
    status: "queued",
    started_at: now,
    completed_at: null,
    error_message: null,
    pages_scanned: 0,
    assets_found: 0,
  });

  void runIrIndexJob({
    userId: params.userId,
    ticker,
    sourceId,
    jobId,
    startUrl: u.url,
  }).catch(() => {});

  return { ok: true, sourceId, jobId };
}

export async function runIrIndexJob(params: {
  userId: string;
  ticker: string;
  sourceId: string;
  jobId: string;
  startUrl: string;
}): Promise<void> {
  const now = nowIso();
  const existingSrc = await getSource(params.userId, params.ticker, params.sourceId);
  if (!existingSrc) {
    await upsertSource(params.userId, params.ticker, {
      id: params.sourceId,
      ticker: params.ticker,
      root_url: params.startUrl,
      company_name: null,
      cik: null,
      status: "running",
      last_indexed_at: null,
      created_at: now,
      updated_at: now,
    });
  } else {
    await upsertSource(params.userId, params.ticker, { ...existingSrc, status: "running", updated_at: now });
  }
  await upsertJob(params.userId, params.ticker, {
    id: params.jobId,
    ir_source_id: params.sourceId,
    status: "running",
    started_at: now,
    completed_at: null,
    error_message: null,
    pages_scanned: 0,
    assets_found: 0,
  });

  try {
    const src = await getSource(params.userId, params.ticker, params.sourceId);
    const rootUrl = src?.root_url ?? params.startUrl;
    const crawled = await crawlIrSite({
      irSourceId: params.sourceId,
      rootUrl,
      startUrl: params.startUrl,
    });

    let assets: IrAsset[] = [];
    const now2 = nowIso();
    for (const a of crawled.assets) {
      const id = stableId([params.sourceId, a.normalized_url]);
      assets.push({
        id,
        ir_source_id: params.sourceId,
        ir_page_id: a.ir_page_id,
        ir_section_id: a.ir_section_id,
        url: a.url,
        normalized_url: a.normalized_url,
        title: a.title,
        asset_type: a.asset_type,
        file_extension: a.file_extension,
        source_type: a.source_type,
        hostname: a.hostname,
        anchor_text: a.anchor_text,
        context_text: a.context_text,
        published_at: a.published_at,
        is_same_domain: a.is_same_domain,
        is_from_sec: false,
        metadata_json: a.metadata_json,
        created_at: now2,
        updated_at: now2,
      });
    }

    const sec = await enrichWithSec({ irSourceId: params.sourceId, ticker: params.ticker });
    if (sec.ok) {
      const dedupe = new Set(assets.map((a) => a.normalized_url.toLowerCase()));
      for (const a of sec.assets) {
        const k = a.normalized_url.toLowerCase();
        if (dedupe.has(k)) continue;
        dedupe.add(k);
        assets.push(a);
      }

      await upsertSource(params.userId, params.ticker, {
        id: params.sourceId,
        ticker: params.ticker,
        root_url: rootUrl,
        company_name: sec.companyName,
        cik: sec.cik,
        status: "running",
        last_indexed_at: null,
        created_at: src?.created_at ?? now2,
        updated_at: now2,
      });
    }

    await replaceSourceData({
      userId: params.userId,
      ticker: params.ticker,
      irSourceId: params.sourceId,
      pages: crawled.pages,
      sections: crawled.sections,
      assets,
    });

    const doneAt = nowIso();
    const src2 = await getSource(params.userId, params.ticker, params.sourceId);
    if (src2) {
      await upsertSource(params.userId, params.ticker, {
        ...src2,
        status: "completed",
        last_indexed_at: doneAt,
        updated_at: doneAt,
      });
    }
    await upsertJob(params.userId, params.ticker, {
      id: params.jobId,
      ir_source_id: params.sourceId,
      status: "completed",
      started_at: now,
      completed_at: doneAt,
      error_message: null,
      pages_scanned: crawled.pages.length,
      assets_found: assets.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Indexing failed";
    const doneAt = nowIso();
    const src2 = await getSource(params.userId, params.ticker, params.sourceId);
    if (src2) await upsertSource(params.userId, params.ticker, { ...src2, status: "failed", updated_at: doneAt });
    await upsertJob(params.userId, params.ticker, {
      id: params.jobId,
      ir_source_id: params.sourceId,
      status: "failed",
      started_at: now,
      completed_at: doneAt,
      error_message: msg,
      pages_scanned: 0,
      assets_found: 0,
    });
  }
}

export async function getIrSummary(params: { userId: string; ticker: string; sourceId: string }) {
  return getSummary(params.userId, params.ticker, params.sourceId);
}
