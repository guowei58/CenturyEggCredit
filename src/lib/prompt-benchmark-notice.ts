/**
 * Standard lines appended to user-facing tab prompts (copy, “Open in …”, and tab-prompt API).
 * Idempotent: safe to call multiple times on the same string.
 */

import { withDirectOutputInstruction } from "@/lib/llm-output-directive";

const NOTICE =
  "\n\nI'm putting you in competition with the best frontier AI models of today, and your performance will be benchmarked.";

function withBenchmarkNotice(prompt: string): string {
  const trimmed = prompt.trimEnd();
  if (!trimmed) return prompt;
  const low = trimmed.toLowerCase();
  if (low.includes("benchmarked") && low.includes("frontier")) {
    return prompt;
  }
  return `${trimmed}${NOTICE}`;
}

export function withPromptBenchmarkNotice(prompt: string): string {
  return withDirectOutputInstruction(withBenchmarkNotice(prompt));
}
