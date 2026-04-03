import type { MemoOutline, MemoOutlineSection } from "./types";
import type { SourceFileRecord } from "./types";
import { isTextLikePath } from "../text-like-extensions";
import { categoryPriority, classifySourceFilename } from "./fileClassifier";

const BASE_SECTIONS: Array<{ id: string; title: string; baseWeight: number }> = [
  { id: "exec", title: "Executive summary & investment thesis", baseWeight: 10 },
  { id: "overview", title: "Company overview", baseWeight: 9 },
  { id: "industry", title: "Industry analysis", baseWeight: 8 },
  { id: "competition", title: "Competitive analysis", baseWeight: 8 },
  { id: "capital", title: "Capital structure", baseWeight: 10 },
  { id: "org", title: "Organizational structure & entities", baseWeight: 8 },
  { id: "docs", title: "Debt document & covenant review", baseWeight: 11 },
  { id: "financials", title: "Historical financial performance & cash flow", baseWeight: 11 },
  { id: "forward", title: "Projections, liquidity & forward cash flow", baseWeight: 10 },
  { id: "valuation", title: "Valuation & recovery framework", baseWeight: 9 },
  { id: "risks", title: "Counter-thesis, key risks & bear case", baseWeight: 9 },
  { id: "trade", title: "Trade recommendation", baseWeight: 8 },
  { id: "appendix", title: "Appendix — source map & gaps", baseWeight: 6 },
];

function sourceRichnessModifiers(sources: SourceFileRecord[]): Record<string, number> {
  const mod: Record<string, number> = {};
  const rels = sources.map((s) => s.relPath.toLowerCase()).join("\n");
  const cats = sources.map((s) => s.category);

  const debtCount = cats.filter((c) => c === "debt_document").length;
  const secCount = cats.filter((c) => c === "sec_filing").length;
  const modelCount = cats.filter((c) => c === "model_spreadsheet").length;

  mod.docs = 1 + Math.min(0.4, debtCount * 0.06);
  mod.financials = 1 + Math.min(0.35, secCount * 0.05 + modelCount * 0.04);
  mod.forward = 1 + Math.min(0.35, modelCount * 0.05);
  mod.capital = 1 + Math.min(0.25, debtCount * 0.03 + secCount * 0.02);

  if (/subsidiar|exhibit\s*21|guarantor/i.test(rels)) mod.org = 1.2;
  if (modelCount >= 2) mod.valuation = 1.15;

  return mod;
}

const MIN_MEMO_WORDS = 2_500;
const MAX_MEMO_WORDS = 120_000;

export function clampMemoWordBudget(raw: number): number {
  if (!Number.isFinite(raw)) return 10_000;
  return Math.min(MAX_MEMO_WORDS, Math.max(MIN_MEMO_WORDS, Math.round(raw)));
}

export function planMemoOutline(targetWords: number, sources: SourceFileRecord[]): MemoOutline {
  const totalWords = clampMemoWordBudget(targetWords);
  const mods = sourceRichnessModifiers(sources);

  const weights = BASE_SECTIONS.map((s) => {
    const m = mods[s.id] ?? 1;
    return { ...s, w: s.baseWeight * m };
  });
  const sumW = weights.reduce((a, s) => a + s.w, 0);

  const sections: MemoOutlineSection[] = weights.map((s) => {
    const sectionWords = Math.max(120, Math.round((totalWords * s.w) / sumW));
    let emphasis = "Standard depth for word budget.";
    if (s.id === "docs" && (mods.docs ?? 1) > 1.1) emphasis = "Richer debt/covenant pack in folder — expand this section.";
    if (s.id === "financials" && (mods.financials ?? 1) > 1.1) emphasis = "Multiple filings/models — prioritize reconciled trends and bridges.";
    if (totalWords <= 6_500) emphasis = "Keep tight: lead with thesis, capital structure, liquidity, and recommendation.";
    return {
      id: s.id,
      title: s.title,
      targetWords: sectionWords,
      emphasis,
    };
  });

  const richness = sources.length
    ? `Folder has ${sources.length} ingestable file(s). Prioritize higher-signal categories when citing.`
    : "No sources ingested — memo must state data gaps explicitly.";

  return {
    targetWords: totalWords,
    totalWordBudget: totalWords,
    sections,
    sourceNotes: richness,
  };
}

export function planMemoOutlineFromTemplate(params: {
  targetWords: number;
  sources: SourceFileRecord[];
  templateTitles: string[];
}): MemoOutline {
  const totalWords = clampMemoWordBudget(params.targetWords);
  const titles = (params.templateTitles ?? []).map((t) => t.trim()).filter((t) => t.length >= 3).slice(0, 40);

  if (titles.length === 0) {
    return planMemoOutline(totalWords, params.sources);
  }

  // Weight known credit-critical sections higher if we can recognize keywords
  const keywordWeight = (t: string): number => {
    const s = t.toLowerCase();
    if (/executive|summary|thesis/.test(s)) return 1.25;
    if (/capital|structure|debt|maturity/.test(s)) return 1.25;
    if (/covenant|indenture|credit\s*agreement|documents?/.test(s)) return 1.3;
    if (/liquidity|cash|revolver/.test(s)) return 1.2;
    if (/financial|ebitda|cash\s*flow|fcf/.test(s)) return 1.2;
    if (/valuation|recovery/.test(s)) return 1.1;
    if (/risk|bear|counter/.test(s)) return 1.1;
    if (/recommend|trade/.test(s)) return 1.1;
    if (/appendix|sources?/.test(s)) return 0.8;
    return 1.0;
  };

  const weights = titles.map((t) => ({ title: t, w: keywordWeight(t) }));
  const sumW = weights.reduce((a, x) => a + x.w, 0);

  const sections: MemoOutlineSection[] = weights.map((x, i) => {
    const sectionWords = Math.max(140, Math.round((totalWords * x.w) / sumW));
    return {
      id: `tpl_${i + 1}`,
      title: x.title,
      targetWords: sectionWords,
      emphasis: "Template-driven section from DOCX outline.",
    };
  });

  const richness = params.sources.length
    ? `Folder has ${params.sources.length} ingestable file(s). Template outline applied.`
    : "No sources ingested — memo must state data gaps explicitly.";

  return {
    targetWords: totalWords,
    totalWordBudget: totalWords,
    sections,
    sourceNotes: richness,
  };
}

/** Sort files for evidence packing: text-like extensions first, then category priority desc, then path */
export function sortSourcesForEvidence(sources: SourceFileRecord[]): SourceFileRecord[] {
  return [...sources].sort((a, b) => {
    const ta = isTextLikePath(a.relPath) ? 1 : 0;
    const tb = isTextLikePath(b.relPath) ? 1 : 0;
    if (tb !== ta) return tb - ta;
    const pa = categoryPriority(a.category);
    const pb = categoryPriority(b.category);
    if (pb !== pa) return pb - pa;
    return a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" });
  });
}

export { classifySourceFilename };
