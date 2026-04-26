import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { getDeepSeekModel } from "@/lib/deepseek";

export const dynamic = "force-dynamic";

/** Lightweight flags for tabs that need provider readiness without running a full source gather. */
export async function GET() {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({
      needsSignIn: true,
      anthropicConfigured: false,
      openaiConfigured: false,
      geminiConfigured: false,
      deepseekConfigured: false,
      deepseekDefaultModel: "",
    });
  }
  const kb = llmAuth.ctx.bundle;
  return NextResponse.json({
    needsSignIn: false,
    anthropicConfigured: isProviderConfigured("claude", kb),
    openaiConfigured: isProviderConfigured("openai", kb),
    geminiConfigured: isProviderConfigured("gemini", kb),
    deepseekConfigured: isProviderConfigured("deepseek", kb),
    deepseekDefaultModel: getDeepSeekModel(),
  });
}
