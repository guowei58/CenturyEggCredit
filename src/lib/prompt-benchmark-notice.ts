/**
 * Standard line appended to user-facing tab prompts (copy, “Open in …”, and tab-prompt API).
 * Idempotent: safe to call multiple times on the same string.
 */

const NOTICE =
  "\n\nI'm putting you in competition with the best frontier AI models of today, and your performance will be benchmarked.";

export function withPromptBenchmarkNotice(prompt: string): string {
  const trimmed = prompt.trimEnd();
  if (!trimmed) return prompt;
  const low = trimmed.toLowerCase();
  if (low.includes("benchmarked") && low.includes("frontier")) {
    return prompt;
  }
  return `${trimmed}${NOTICE}`;
}
