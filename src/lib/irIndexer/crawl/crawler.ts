import type { IrAsset, IrPage, IrSection } from "../types";
import { loadIrIndexerConfigFromEnv, type IrIndexerConfig } from "../config";
import { dedupeAssets, dedupePages } from "./dedupe";
import { renderAndExtractPage } from "../extract/renderAndExtract";
import { hostnameOf, normalizeUrlForMatch } from "../utils";

const JUNK = [
  "/careers",
  "/jobs",
  "/login",
  "/logout",
  "/signin",
  "/sign-in",
  "/privacy",
  "/terms",
  "/contact",
];

function looksJunkPath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return JUNK.some((x) => p.includes(x));
  } catch {
    return true;
  }
}

export async function crawlIrSite(params: {
  irSourceId: string;
  rootUrl: string;
  startUrl: string;
  config?: Partial<IrIndexerConfig>;
}): Promise<{
  pages: IrPage[];
  sections: IrSection[];
  assets: Array<Omit<IrAsset, "id" | "ir_source_id" | "created_at" | "updated_at">>;
}> {
  const env = loadIrIndexerConfigFromEnv();
  const cfg: IrIndexerConfig = { ...env, ...(params.config ?? {}) };

  const rootNorm = normalizeUrlForMatch(params.rootUrl) ?? params.rootUrl;
  const rootHost = hostnameOf(rootNorm);

  const queue: Array<{ url: string; depth: number }> = [{ url: params.startUrl, depth: 0 }];
  const seenPages = new Set<string>();
  const pages: IrPage[] = [];
  const sections: IrSection[] = [];
  const assets: Array<Omit<IrAsset, "id" | "ir_source_id" | "created_at" | "updated_at">> = [];

  while (queue.length > 0 && pages.length < cfg.maxPages) {
    const item = queue.shift()!;
    const norm = normalizeUrlForMatch(item.url) ?? item.url;
    const key = norm.toLowerCase();
    if (seenPages.has(key)) continue;
    seenPages.add(key);
    if (cfg.sameDomainOnly && rootHost) {
      const host = hostnameOf(norm);
      const same = host === rootHost || host.endsWith(`.${rootHost}`);
      if (!same) continue;
    }
    if (looksJunkPath(norm)) continue;

    const r = await renderAndExtractPage({
      irSourceId: params.irSourceId,
      url: item.url,
      depth: item.depth,
      timeoutMs: cfg.timeoutMs,
      rootUrl: rootNorm,
    });
    pages.push(r.page);
    sections.push(...r.sections);
    assets.push(...r.assets);

    if (item.depth < cfg.maxDepth) {
      const next = dedupePages(r.discoveredChildPages).filter((u) => !looksJunkPath(u));
      for (const u of next) {
        if (queue.length + pages.length >= cfg.maxPages) break;
        queue.push({ url: u, depth: item.depth + 1 });
      }
    }
  }

  const dedupedAssets = dedupeAssets(assets);
  return { pages, sections, assets: dedupedAssets };
}

