import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import { runKpiCommentaryFromTicker } from "@/lib/kpi-commentary-run";
import type { CreditMemoProject } from "./types";

export async function runKpiGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  provider: AiProvider;
  companyName?: string;
  models: CovenantResolvedModels;
  apiKeys: LlmCallApiKeys;
}): Promise<
  | {
      ok: true;
      markdown: string;
      sourcePack: string;
      contextSentUtf8Bytes: number;
      sourceFingerprint: string;
    }
  | { ok: false; error: string }
> {
  return runKpiCommentaryFromTicker({
    ticker: params.project.ticker,
    userId: params.userId,
    provider: params.provider,
    companyName: params.companyName,
    models: params.models,
    apiKeys: params.apiKeys,
  });
}
