/**
 * User-controlled response depth for in-app LLM calls (stored in account preferences).
 */

import type { UserPreferencesData, UserResponseVerbosity } from "@/lib/user-preferences-types";

export type ResponseVerbosity = UserResponseVerbosity;

/** When prefs omit `responseVerbosity`, behave like before the MD/Analyst feature: no extra global brevity layer. */
export const DEFAULT_RESPONSE_VERBOSITY: ResponseVerbosity = "analyst";

/** Explicit `md` only; anything else (undefined / `analyst`) = legacy full-detail baseline. */
export function resolveResponseVerbosity(raw: unknown): ResponseVerbosity {
  return raw === "md" ? "md" : "analyst";
}

export function responseVerbosityFromPreferences(prefs: UserPreferencesData | null | undefined): ResponseVerbosity {
  return resolveResponseVerbosity(prefs?.responseVerbosity);
}

/**
 * Appended to cloud system prompts (between date/time prefix and verification block).
 * Analyst adds **nothing** so behavior matches pre-verbosity OREO (task prompts + verification only).
 * MD adds explicit compression (~half the narrative volume vs a full diligence write-up).
 */
export function responseVerbosityInstruction(v: ResponseVerbosity): string {
  if (v === "analyst") {
    return "";
  }

  return `

Response depth (user preference — MD: time-efficient read, ~half the prose vs a full analyst-style answer):
- Target roughly **50% of the narrative length** you would use for an unrestricted diligence draft: fewer paragraphs, shorter sentences, more bullets and subheadings—**without** dropping material facts, figures, dates, risks, or caveats.
- Lead with the answer and key evidence; avoid throat-clearing, repetition, and long scene-setting.
- Do **not** omit important information to save space; achieve brevity by tightening wording and structure, not by skipping disclosures the user would need.
- If a section would normally run long, summarize the logic in 1–2 tight paragraphs plus a short bullet list of the critical points.`;
}
