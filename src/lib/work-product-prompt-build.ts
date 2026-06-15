import { KPI_SYSTEM_PROMPT } from "@/data/kpi-prompt";
import { LME_ANALYSIS_SYSTEM } from "@/data/lme-analysis-prompt";
import { CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT } from "@/data/cap-structure-recommendation-prompt";
import {
  buildBiblicalReferencesSystemPrompt,
  buildBiblicalReferencesUserPrompt,
} from "@/data/biblical-references-prompt";
import {
  buildHowToLookLikeADumbassSystemPrompt,
  buildHowToLookLikeADumbassUserPrompt,
} from "@/data/how-to-look-like-a-dumbass-prompt";
import {
  buildLiteraryReferencesSystemPrompt,
  buildLiteraryReferencesUserPrompt,
} from "@/data/literary-references-prompt";
import {
  buildNextQuarterEarningsTranscriptSystemPrompt,
  buildNextQuarterEarningsTranscriptUserPrompt,
} from "@/data/next-quarter-earnings-transcript-prompt";
import { buildForensicAccountingPromptPackage } from "@/lib/creditMemo/generateForensicAccountingAnalysis";
import { gatherCsRecommendationSources, formatSourcesForCsRecommendation } from "@/lib/cs-recommendation-sources";
import {
  gatherCreativeWorkspaceSources,
  buildCreativeWorkspaceInventory,
  buildCreativeWorkspaceMaterials,
  type CreativeWorkspacePromptKind,
} from "@/lib/creative-workspace-sources";
import { gatherKpiCommentarySources, formatSourcesForKpiCommentary } from "@/lib/kpi-workspace-sources";
import { gatherLmeSources, formatSourcesForLme } from "@/lib/lme-sources";
import { buildKpiCommentaryUserMessage } from "@/lib/kpi-commentary-synthesis";
import { buildLmeAnalysisUserMessage } from "@/lib/lme-analysis-synthesis";
import { buildCapStructureRecommendationUserMessage } from "@/lib/cap-structure-recommendation-synthesis";
import type { LmeRunPackingStats } from "@/lib/lme-sources";
import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { formatWorkProductPromptForExternalCopy } from "@/lib/work-product-prompt-format";

export type WorkProductPromptKind =
  | "kpi"
  | "lme"
  | "forensic"
  | "recommendation"
  | CreativeWorkspacePromptKind;

const CREATIVE_KINDS = new Set<CreativeWorkspacePromptKind>([
  "literary",
  "biblical",
  "dumbass",
  "earnings-transcript",
]);

const CREATIVE_NO_SOURCES_ERROR: Record<CreativeWorkspacePromptKind, string> = {
  literary:
    "No substantive sources found. Save at least one Work Product tab output (KPI, Forensic, LME, Recommendation, AI Memo, etc.) and/or an earnings transcript from Period Financials, then refresh sources.",
  biblical:
    "No substantive sources found. Save at least one Work Product tab output (KPI, Forensic, LME, Recommendation, AI Memo, etc.) and/or an earnings transcript from Period Financials, then refresh sources.",
  dumbass:
    "No substantive sources found. Save at least one Work Product tab output (KPI, Forensic, LME, Recommendation, AI Memo, etc.) and/or an earnings transcript from Period Financials, then refresh sources.",
  "earnings-transcript":
    "No substantive sources found. Save at least one Work Product tab output (KPI, Forensic, LME, Recommendation, AI Memo, etc.) and/or an earnings transcript from Period Financials, then refresh sources.",
};

function emptyCreativeUserBreakdown(userPromptLength: number): LmeUserMessageCharBreakdown {
  return {
    taskSpecChars: 0,
    bridgeChars: 0,
    formattedSourcesChars: userPromptLength,
    totalUserMessageChars: userPromptLength,
  };
}

async function buildCreativeWorkspacePromptPackage(params: {
  kind: CreativeWorkspacePromptKind;
  ticker: string;
  userId: string;
  apiKeys: LlmCallApiKeys;
  companyName?: string;
}): Promise<{ ok: true; package: WorkProductPromptPackage } | { ok: false; error: string }> {
  const bundled = await gatherCreativeWorkspaceSources("other-memos", params.ticker, undefined, params.userId, {
    apiKeys: params.apiKeys,
    useRetrieval: true,
  });
  if (!bundled.hasSubstantiveText) {
    return { ok: false, error: CREATIVE_NO_SOURCES_ERROR[params.kind] };
  }
  const packingStats = bundled.packingStats;
  if (!packingStats) {
    return { ok: false, error: "Internal error: missing packing stats." };
  }

  const inventory = buildCreativeWorkspaceInventory(bundled.parts);
  const materials = buildCreativeWorkspaceMaterials(bundled.parts);
  const sym = params.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  let systemPrompt: string;
  let userPrompt: string;

  if (params.kind === "literary") {
    systemPrompt = buildLiteraryReferencesSystemPrompt(sym, params.companyName);
    userPrompt = buildLiteraryReferencesUserPrompt({ inventory, materials });
  } else if (params.kind === "biblical") {
    systemPrompt = buildBiblicalReferencesSystemPrompt(sym, params.companyName);
    userPrompt = buildBiblicalReferencesUserPrompt({ inventory, materials });
  } else if (params.kind === "dumbass") {
    systemPrompt = buildHowToLookLikeADumbassSystemPrompt(sym, params.companyName);
    userPrompt = buildHowToLookLikeADumbassUserPrompt({ inventory, materials });
  } else {
    systemPrompt = buildNextQuarterEarningsTranscriptSystemPrompt(sym, params.companyName);
    userPrompt = buildNextQuarterEarningsTranscriptUserPrompt({ inventory, materials });
  }

  const userMessageBreakdown: LmeUserMessageCharBreakdown = emptyCreativeUserBreakdown(userPrompt.length);

  return {
    ok: true,
    package: {
      kind: params.kind,
      ticker: sym,
      systemPrompt,
      userPrompt,
      copyPrompt: formatWorkProductPromptForExternalCopy(systemPrompt, userPrompt),
      retrievalUsed: bundled.retrievalUsed,
      packingStats,
      userMessageBreakdown,
      sourceFingerprint: bundled.sourceFingerprint,
    },
  };
}

export type WorkProductPromptPackage = {
  kind: WorkProductPromptKind;
  ticker: string;
  systemPrompt: string;
  userPrompt: string;
  copyPrompt: string;
  retrievalUsed: boolean;
  packingStats: LmeRunPackingStats;
  userMessageBreakdown: LmeUserMessageCharBreakdown;
  sourceFingerprint: string;
};

export async function buildWorkProductPromptPackage(params: {
  kind: WorkProductPromptKind;
  ticker: string;
  userId: string;
  apiKeys: LlmCallApiKeys;
  companyName?: string;
}): Promise<{ ok: true; package: WorkProductPromptPackage } | { ok: false; error: string }> {
  const sym = params.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) {
    return { ok: false, error: "Invalid ticker" };
  }

  if (CREATIVE_KINDS.has(params.kind as CreativeWorkspacePromptKind)) {
    return buildCreativeWorkspacePromptPackage({
      kind: params.kind as CreativeWorkspacePromptKind,
      ticker: sym,
      userId: params.userId,
      apiKeys: params.apiKeys,
      companyName: params.companyName,
    });
  }

  if (params.kind === "kpi") {
    const bundled = await gatherKpiCommentarySources(sym, undefined, params.userId, {
      apiKeys: params.apiKeys,
      useRetrieval: true,
    });
    if (!bundled.hasSubstantiveText) {
      return {
        ok: false,
        error:
          "No substantive KPI sources found. Save at least one management presentation or earnings transcript from Period Financials, then refresh sources.",
      };
    }
    const packingStats = bundled.packingStats;
    if (!packingStats) {
      return { ok: false, error: "Internal error: missing packing stats." };
    }
    const sourcesFormatted = formatSourcesForKpiCommentary(sym, bundled.parts);
    const { user, userMessageBreakdown } = buildKpiCommentaryUserMessage(
      sourcesFormatted,
      sym,
      params.companyName
    );
    const systemPrompt = KPI_SYSTEM_PROMPT;
    return {
      ok: true,
      package: {
        kind: "kpi",
        ticker: sym,
        systemPrompt,
        userPrompt: user,
        copyPrompt: formatWorkProductPromptForExternalCopy(systemPrompt, user),
        retrievalUsed: bundled.retrievalUsed,
        packingStats,
        userMessageBreakdown,
        sourceFingerprint: bundled.sourceFingerprint,
      },
    };
  }

  if (params.kind === "lme") {
    const bundled = await gatherLmeSources(sym, undefined, params.userId, {
      apiKeys: params.apiKeys,
      useRetrieval: true,
    });
    if (!bundled.hasSubstantiveText) {
      return {
        ok: false,
        error:
          "No substantive LME sources found. Save Capital Structure section tabs/docs and the business model tab, then refresh sources.",
      };
    }
    const packingStats = bundled.packingStats;
    if (!packingStats) {
      return { ok: false, error: "Internal error: missing packing stats." };
    }
    const sourcesFormatted = formatSourcesForLme(sym, bundled.parts);
    const { user, userMessageBreakdown } = buildLmeAnalysisUserMessage(sourcesFormatted);
    const systemPrompt = LME_ANALYSIS_SYSTEM;
    return {
      ok: true,
      package: {
        kind: "lme",
        ticker: sym,
        systemPrompt,
        userPrompt: user,
        copyPrompt: formatWorkProductPromptForExternalCopy(systemPrompt, user),
        retrievalUsed: bundled.retrievalUsed,
        packingStats,
        userMessageBreakdown,
        sourceFingerprint: bundled.sourceFingerprint,
      },
    };
  }

  if (params.kind === "forensic") {
    const built = await buildForensicAccountingPromptPackage({
      ticker: sym,
      companyName: params.companyName,
      userId: params.userId,
      apiKeys: params.apiKeys,
    });
    if (!built.ok) {
      return built;
    }
    return {
      ok: true,
      package: {
        kind: "forensic",
        ticker: sym,
        systemPrompt: built.systemPrompt,
        userPrompt: built.userPrompt,
        copyPrompt: formatWorkProductPromptForExternalCopy(built.systemPrompt, built.userPrompt),
        retrievalUsed: built.diagnostics.retrievalUsed,
        packingStats: built.packingStats,
        userMessageBreakdown: built.diagnostics.userMessageBreakdown,
        sourceFingerprint: built.sourceFingerprint,
      },
    };
  }

  const bundled = await gatherCsRecommendationSources(sym, undefined, params.userId, {
    apiKeys: params.apiKeys,
    useRetrieval: true,
  });
  if (!bundled.hasSubstantiveText) {
    return {
      ok: false,
      error:
        "No substantive recommendation sources found. Save tab text files and/or saved LME, KPI, or Forensic outputs, then refresh sources.",
    };
  }
  const packingStats = bundled.packingStats;
  if (!packingStats) {
    return { ok: false, error: "Internal error: missing packing stats." };
  }
  const sourcesFormatted = formatSourcesForCsRecommendation(sym, bundled.parts);
  const { user, userMessageBreakdown } = buildCapStructureRecommendationUserMessage(sourcesFormatted);
  const systemPrompt = CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT;
  return {
    ok: true,
    package: {
      kind: "recommendation",
      ticker: sym,
      systemPrompt,
      userPrompt: user,
      copyPrompt: formatWorkProductPromptForExternalCopy(systemPrompt, user),
      retrievalUsed: bundled.retrievalUsed,
      packingStats,
      userMessageBreakdown,
      sourceFingerprint: bundled.sourceFingerprint,
    },
  };
}
