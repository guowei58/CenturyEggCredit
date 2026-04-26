import type { AiProvider } from "@/lib/ai-provider";
import { presetsForProvider, sanitizeClientModelId } from "@/lib/ai-model-options";

/** Shown at top of the limits panel — limits come from vendors, not OREO. */
export const PROVIDER_LIMITS_INTRO =
  "Values below are taken from each vendor’s public API documentation (or their official pricing/spec tables). They are not OREO limits. Exact caps can change when a provider updates a model; use the documentation link for the latest numbers.";

export const OREO_INGEST_NOTE =
  "Folder ingest and source packaging on OREO’s servers are separate from these API limits; we send text to the provider within whatever context window applies.";

const fmt = (n: number) => n.toLocaleString("en-US");

export type ResolvedModelLimits = {
  provider: AiProvider;
  /** Raw id when known, or description for custom / unset */
  modelKey: string;
  match: "exact" | "unlisted" | "unset";
  displayTitle: string;
  contextWindow: string;
  maxOutput: string;
  rateLimits: string;
  filesAndUploads: string;
  documentationUrl: string;
  footnotes: string[];
};

type LimitRow = {
  contextInputTokens: number;
  maxOutputTokens: number;
  /** Extra line about batch / beta headers etc. */
  outputNote?: string;
  rateLimits: string;
  filesAndUploads: string;
  docUrl: string;
  notes?: string[];
};

function rowToResolved(
  provider: AiProvider,
  modelId: string,
  presetLabel: string | undefined,
  r: LimitRow
): ResolvedModelLimits {
  const footnotes = [...(r.notes ?? [])];
  if (r.outputNote) footnotes.push(r.outputNote);
  return {
    provider,
    modelKey: modelId,
    match: "exact",
    displayTitle: presetLabel ? `${presetLabel} (${modelId})` : modelId,
    contextWindow: `${fmt(r.contextInputTokens)} tokens (input context)`,
    maxOutput: `${fmt(r.maxOutputTokens)} tokens (max completion / \`max_tokens\` ceiling where applicable)`,
    rateLimits: r.rateLimits,
    filesAndUploads: r.filesAndUploads,
    documentationUrl: r.docUrl,
    footnotes,
  };
}

/** Per-model rows — ids must match `ai-model-options` presets where possible. Numbers from vendor docs as of early 2026. */
const CLAUDE: Record<string, LimitRow> = {
  "claude-opus-4-6": {
    contextInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    outputNote:
      "Messages API (sync): up to 128k output per Anthropic’s models table. Batch API can allow higher output with beta headers — see Anthropic batch docs.",
    rateLimits:
      "Requests/min and tokens/min depend on your Anthropic plan and usage tier (Console → Limits). Long-context (for example prompts over 200k tokens) may use different pricing.",
    filesAndUploads:
      "Files API: individual file size limits are set by Anthropic (see Files API docs). Request body size limit applies to HTTP API calls.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
  "claude-sonnet-4-6": {
    contextInputTokens: 1_000_000,
    maxOutputTokens: 64_000,
    outputNote: "Batch API may support extended output with separate beta headers.",
    rateLimits:
      "Anthropic rate limits vary by tier; check Console and response headers.",
    filesAndUploads:
      "Same as other Claude models — Files API limits in Anthropic documentation.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
  "claude-sonnet-4-20250514": {
    contextInputTokens: 200_000,
    maxOutputTokens: 64_000,
    notes: ["Listed as deprecated in Anthropic docs — migrate to Sonnet 4.6 before retirement."],
    rateLimits: "Anthropic tier-based RPM/TPM; see Console.",
    filesAndUploads: "Claude Files API limits per Anthropic docs.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
  "claude-haiku-4-5-20251001": {
    contextInputTokens: 200_000,
    maxOutputTokens: 64_000,
    rateLimits: "Anthropic tier-based RPM/TPM; see Console.",
    filesAndUploads: "Claude Files API limits per Anthropic docs.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
  "claude-3-5-sonnet-20241022": {
    contextInputTokens: 200_000,
    maxOutputTokens: 8_192,
    notes: ["Claude 3.5 generation: typical API max output 8,192 tokens unless otherwise increased in your account."],
    rateLimits: "Anthropic tier-based RPM/TPM; see Console.",
    filesAndUploads: "Claude Files API limits per Anthropic docs.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
  "claude-3-5-haiku-20241022": {
    contextInputTokens: 200_000,
    maxOutputTokens: 8_192,
    rateLimits: "Anthropic tier-based RPM/TPM; see Console.",
    filesAndUploads: "Claude Files API limits per Anthropic docs.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
  "claude-3-opus-20240229": {
    contextInputTokens: 200_000,
    maxOutputTokens: 4_096,
    notes: ["Legacy Claude 3 Opus snapshot — consider newer models for long outputs."],
    rateLimits: "Anthropic tier-based RPM/TPM; see Console.",
    filesAndUploads: "Claude Files API limits per Anthropic docs.",
    docUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
  },
};

/** OpenAI Chat Completions / Responses — typical API limits; GPT-5.x varies by endpoint. */
const OPENAI: Record<string, LimitRow> = {
  "gpt-5.4": {
    contextInputTokens: 400_000,
    maxOutputTokens: 128_000,
    notes: ["If OpenAI revises this model id, confirm context/output on the OpenAI Models page — GPT-5-class models use large windows on the API."],
    rateLimits:
      "OpenAI: RPM, TPM, RPD, TPD depend on organization usage tier (platform.openai.com → Limits).",
    filesAndUploads:
      "Assistants / file tools have separate upload limits; chat with pasted text is constrained by context window.",
    docUrl: "https://platform.openai.com/docs/models",
  },
  "gpt-4o": {
    contextInputTokens: 128_000,
    maxOutputTokens: 16_384,
    rateLimits: "Tier-based RPM/TPM; see OpenAI Limits page.",
    filesAndUploads: "File inputs where supported follow OpenAI file policies; standard chat uses context window only.",
    docUrl: "https://platform.openai.com/docs/models",
  },
  "gpt-4-turbo": {
    contextInputTokens: 128_000,
    maxOutputTokens: 4_096,
    notes: ["Classic GPT-4 Turbo completions often capped at 4,096 output tokens on Chat Completions — check model card if using a newer snapshot."],
    rateLimits: "Tier-based RPM/TPM; see OpenAI Limits page.",
    filesAndUploads: "Same as other Chat Completions models.",
    docUrl: "https://platform.openai.com/docs/models",
  },
  "gpt-4o-mini": {
    contextInputTokens: 128_000,
    maxOutputTokens: 16_384,
    rateLimits: "Tier-based RPM/TPM; see OpenAI Limits page.",
    filesAndUploads: "Same as gpt-4o family.",
    docUrl: "https://platform.openai.com/docs/models",
  },
};

/** Google Gemini — Vertex / AI Studio list 1,048,576 input / 65,535 output for 2.5 Flash family. */
const GEMINI: Record<string, LimitRow> = {
  "gemini-2.5-pro": {
    contextInputTokens: 1_048_576,
    maxOutputTokens: 65_535,
    rateLimits:
      "Google: RPM/TPM/RPD depend on AI Studio / Cloud project tier — see ai.google.dev rate-limits and your console.",
    filesAndUploads:
      "Multimodal inputs (files, video, etc.) have per-type limits in Gemini docs (image counts, document pages).",
    docUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
  "gemini-2.5-flash": {
    contextInputTokens: 1_048_576,
    maxOutputTokens: 65_535,
    rateLimits: "Google tier-based quotas; see Gemini rate limits documentation.",
    filesAndUploads: "Multimodal limits per Gemini model card.",
    docUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
  "gemini-2.5-flash-lite": {
    contextInputTokens: 1_048_576,
    maxOutputTokens: 65_535,
    rateLimits: "Google tier-based quotas; see Gemini rate limits documentation.",
    filesAndUploads: "Multimodal limits per Gemini model card.",
    docUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
};

/** DeepSeek official pricing table (DeepSeek-V3.2 API). */
const DEEPSEEK: Record<string, LimitRow> = {
  "deepseek-chat": {
    contextInputTokens: 128_000,
    maxOutputTokens: 8_192,
    notes: ["Default max output 4,096 tokens; API allows up to 8,192 completion tokens (DeepSeek pricing page)."],
    rateLimits:
      "DeepSeek states no fixed RPM in docs; heavy load may throttle. See api-docs.deepseek.com rate_limit.",
    filesAndUploads: "Chat API is text-in; request size bounded by context + provider limits.",
    docUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  "deepseek-reasoner": {
    contextInputTokens: 128_000,
    maxOutputTokens: 64_000,
    notes: ["Default max output 32,768; maximum 64,000 completion tokens per DeepSeek pricing table."],
    rateLimits: "Same as deepseek-chat — see DeepSeek rate limit doc.",
    filesAndUploads: "Text-in chat API; reasoning content counts toward output tokens.",
    docUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
};

const TABLES: Record<AiProvider, Record<string, LimitRow>> = {
  claude: CLAUDE,
  openai: OPENAI,
  gemini: GEMINI,
  deepseek: DEEPSEEK,
};

function presetLabel(provider: AiProvider, modelId: string): string | undefined {
  return presetsForProvider(provider).find((p) => p.id === modelId)?.label;
}

function unsetResolved(provider: AiProvider): ResolvedModelLimits {
  const doc =
    provider === "claude"
      ? "https://platform.claude.com/docs/en/about-claude/models/overview"
      : provider === "openai"
        ? "https://platform.openai.com/docs/models"
        : provider === "gemini"
          ? "https://ai.google.dev/gemini-api/docs/models"
          : "https://api-docs.deepseek.com/quick_start/pricing";
  return {
    provider,
    modelKey: "",
    match: "unset",
    displayTitle: "API model: server default (.env)",
    contextWindow:
      "Not selected in User Settings — the running server picks a model from environment variables. Context size depends on that model id.",
    maxOutput:
      "Depends on the env-configured model; this app may request up to a large completion budget but the provider still enforces per-model caps.",
    rateLimits: "Whatever your API key’s tier allows for the resolved model (check the provider’s console).",
    filesAndUploads: "Provider file / upload features (if any) follow that vendor’s docs.",
    documentationUrl: doc,
    footnotes: ["Choose a preset in API model or enter a custom id to see documented limits for that model here."],
  };
}

function unlistedResolved(provider: AiProvider, modelId: string): ResolvedModelLimits {
  const docUrl =
    provider === "claude"
      ? "https://platform.claude.com/docs/en/about-claude/models/overview"
      : provider === "openai"
        ? "https://platform.openai.com/docs/models"
        : provider === "gemini"
          ? "https://ai.google.dev/gemini-api/docs/models"
          : "https://api-docs.deepseek.com/quick_start/pricing";
  return {
    provider,
    modelKey: modelId,
    match: "unlisted",
    displayTitle: `Custom model id: ${modelId}`,
    contextWindow:
      "No built-in row for this exact id — consult the provider’s model list or GET /models API. Typical ranges vary widely.",
    maxOutput: "See provider documentation for this model id; unknown ids cannot be summarized here.",
    rateLimits: "Depends on your account tier with this provider.",
    filesAndUploads: "Follow the vendor’s documentation for file-capable endpoints.",
    documentationUrl: docUrl,
    footnotes: [
      "Anthropic, OpenAI, and others expose a Models API listing max_input_tokens and max_output_tokens per id — use that for authoritative numbers.",
    ],
  };
}

/**
 * Resolve documented limits for a provider + model id from in-app tables.
 * Pass `undefined` or empty string for “default .env” (unset in preferences).
 */
export function resolveModelLimits(provider: AiProvider, modelId: string | null | undefined): ResolvedModelLimits {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  const ok = sanitizeClientModelId(id);
  if (!ok) {
    return unsetResolved(provider);
  }

  const row = TABLES[provider][ok];
  if (row) {
    return rowToResolved(provider, ok, presetLabel(provider, ok), row);
  }
  return unlistedResolved(provider, ok);
}
