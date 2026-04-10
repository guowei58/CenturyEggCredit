/**
 * User-controlled response depth for in-app LLM calls (stored in account preferences).
 */

import type { UserPreferencesData, UserResponseVerbosity } from "@/lib/user-preferences-types";

export type ResponseVerbosity = UserResponseVerbosity;

export const DEFAULT_RESPONSE_VERBOSITY: ResponseVerbosity = "md";

export function resolveResponseVerbosity(raw: unknown): ResponseVerbosity {
  return raw === "analyst" ? "analyst" : "md";
}

export function responseVerbosityFromPreferences(prefs: UserPreferencesData | null | undefined): ResponseVerbosity {
  return resolveResponseVerbosity(prefs?.responseVerbosity);
}

/**
 * Appended to every cloud system prompt (after the task prompt, with date/time + verification block).
 */
export function responseVerbosityInstruction(v: ResponseVerbosity): string {
  if (v === "analyst") {
    return `

Response depth (user preference — Analyst: don't want to miss a thing):
- Be thorough and comprehensive. Err on the side of including material detail, caveats, and second-order points when they help judgment.
- Use structure (headings, bullets, tables) when it improves clarity; longer answers are fine when analytically useful.
- Still avoid pure filler, repetition, and generic platitudes.`;
  }

  return `

Response depth (user preference — MD: no time to chit-chat):
- The user is engaged and wants to learn about the company but is time-constrained. Be direct: no small talk, long preambles, or rhetorical throat-clearing.
- Prioritize signal over noise: lead with conclusions and material facts; use tight bullets and short sections where helpful.
- Do **not** sacrifice substance for brevity: keep all **material** facts, figures, dates, risks, legal/credit nuances, and caveats that would change a reader's understanding. Compress via structure and precision, not by omitting important information.
- If you must shorten, drop lower-value elaboration—not critical disclosures.`;
}
