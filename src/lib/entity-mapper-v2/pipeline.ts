import { formatDebtDocSearchAnalystMarkdown } from "@/lib/creditDocs/formatDebtDocSearchAnalystMarkdown";
import { runDebtDocSearch } from "@/lib/creditDocs/edgarDebtDocSearch/runDebtDocSearch";
import { saveDebtDiscoveryRowsToSavedDocuments } from "@/lib/creditDocs/saveDebtDiscoveryToSavedDocuments";
import { gatherCsRecommendationSources, formatSourcesForCsRecommendation } from "@/lib/cs-recommendation-sources";
import { debtInventoryFromEdgarSearch } from "@/lib/entity-mapper-v2/inventoryFromEdgar";
import { loadExhibit21UniverseForTicker } from "@/lib/entity-mapper-v2/exhibit21Universe";
import {
  buildSnapshotFromLlmJson,
  extractFirstJsonObject,
  finalizeSnapshotMatrices,
} from "@/lib/entity-mapper-v2/parseSnapshot";
import { synthesizeEntityMapperV2Json, buildEntityMapperV2UserPayload } from "@/lib/entity-mapper-v2/synthesize";
import { getCompanyProfile } from "@/lib/sec-edgar";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import type { AiProvider } from "@/lib/ai-provider";
import type { ModelOverrideBody } from "@/lib/ai-model-from-request";
import { resolveLmeAnalysisModels } from "@/lib/ai-model-from-request";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

import type { DebtInventoryItem } from "@/lib/entity-mapper-v2/types";

import type { EntityMapperV2Snapshot } from "@/lib/entity-mapper-v2/types";

export type EntityMapperV2PipelineOpts = {
  userId: string;
  ticker: string;
  provider: AiProvider;
  bundle: LlmCallApiKeys;
  models: CovenantResolvedModels;
  companyNameHint?: string | null;
  discoverSecDocuments?: boolean;
  downloadExhibitsToSavedDocs?: boolean;
  maxSavedDocumentDownloads?: number;
  lookbackYears?: number;
  maxFilingsCap?: number;
  maxDownloadClassify?: number;
  writeSecDebtMarkdown?: boolean;
};

export async function runEntityMapperV2Pipeline(
  opts: EntityMapperV2PipelineOpts
): Promise<
  | {
      ok: true;
      snapshot: EntityMapperV2Snapshot;
      savedDocumentsSummary: Awaited<ReturnType<typeof saveDebtDiscoveryRowsToSavedDocuments>> | null;
    }
  | { ok: false; error: string; code: "no_subsidiaries" | "no_sources" | "llm" | "parse" | "persist" | "edgar" }
> {
  const sym = opts.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { rows: universe } = await loadExhibit21UniverseForTicker(opts.userId, sym);
  if (!universe.length) {
    return {
      ok: false,
      error:
        "No Exhibit 21 subsidiaries found. Open Overview → Public Records Profile, load or edit Exhibit 21, save the profile, then try again.",
      code: "no_subsidiaries",
    };
  }

  let inventory: { items: DebtInventoryItem[]; families: string[] } = { items: [], families: [] };

  let savedDocs: Awaited<ReturnType<typeof saveDebtDiscoveryRowsToSavedDocuments>> | null = null;

  if (opts.discoverSecDocuments !== false) {
    const search = await runDebtDocSearch({
      ticker: sym,
      companyName: opts.companyNameHint ?? undefined,
      lookbackYears: opts.lookbackYears ?? 15,
      includeDef14a: true,
      maxFilingsCap: opts.maxFilingsCap ?? 120,
      maxDownloadClassify: opts.maxDownloadClassify ?? 48,
    });
    if (!search) {
      return { ok: false, error: "EDGAR CIK/submissions lookup failed for this ticker.", code: "edgar" };
    }
    const built = debtInventoryFromEdgarSearch(search);
    inventory = built;

    if (opts.downloadExhibitsToSavedDocs !== false) {
      savedDocs = await saveDebtDiscoveryRowsToSavedDocuments(opts.userId, sym, search.table, {
        maxDownloads: opts.maxSavedDocumentDownloads ?? 80,
      });
    }

    if (opts.writeSecDebtMarkdown !== false) {
      const md = formatDebtDocSearchAnalystMarkdown(search, sym, {
        savedDocuments: savedDocs ?? undefined,
      });
      await writeSavedContent(sym, "entity-mapper-sec-debt-index", md, opts.userId);
    }
  }

  const inv = inventory;

  const bundled = await gatherCsRecommendationSources(sym, undefined, opts.userId, {
    apiKeys: opts.bundle,
    useRetrieval: true,
  });
  if (!bundled.hasSubstantiveText) {
    return {
      ok: false,
      error:
        "No substantive financing text in workspace. Run SEC discovery above or add credit agreements / Saved Documents, then retry.",
      code: "no_sources",
    };
  }

  let displayName = opts.companyNameHint?.trim() ?? "";
  let cik: string | null = null;
  try {
    const profile = await getCompanyProfile(sym);
    if (profile?.cik) cik = profile.cik;
    if (!displayName && profile?.name) displayName = profile.name.trim();
  } catch {
    /* optional */
  }

  const sourcesFormatted = formatSourcesForCsRecommendation(sym, bundled.parts);
  const userPayload = buildEntityMapperV2UserPayload({
    ticker: sym,
    companyName: displayName || null,
    cik,
    universe,
    inventory: inv.items,
    inventoryFamilies: inv.families,
    sourcesFormatted,
  });

  const syn = await synthesizeEntityMapperV2Json({
    userPayload,
    provider: opts.provider,
    models: opts.models,
    apiKeys: opts.bundle,
  });
  if (!syn.ok) return { ok: false, error: syn.error, code: "llm" };

  let parsed: unknown;
  try {
    parsed = extractFirstJsonObject(syn.rawText);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to parse JSON from model",
      code: "parse",
    };
  }

  const registrantNamesForFilter = Array.from(
    new Set(
      [opts.companyNameHint?.trim(), displayName]
        .filter((x): x is string => Boolean(x && x.trim()))
    )
  );

  const generatedAtIso = new Date().toISOString();
  let snapshot = buildSnapshotFromLlmJson(parsed, {
    ticker: sym,
    universe,
    inventory: inv.items,
    inventoryFamilies: inv.families,
    generatedAtIso,
    registrantNamesForFilter,
  });
  snapshot = finalizeSnapshotMatrices(snapshot);

  const json = JSON.stringify(snapshot, null, 2);
  const w = await writeSavedContent(sym, "entity-mapper-v2-snapshot", json, opts.userId);
  if (!w.ok) return { ok: false, error: w.error, code: "persist" };

  return { ok: true, snapshot, savedDocumentsSummary: savedDocs };
}

export function modelsFromBody(body: ModelOverrideBody): CovenantResolvedModels {
  return resolveLmeAnalysisModels(body);
}
