/**
 * Global instruction: deliver requested deliverables directly; background context is fine
 * but should not be summarized as preamble. Appended to API system prompts and tab prompt copy.
 */

export const LLM_DIRECT_OUTPUT_INSTRUCTION = `

Output discipline (required):
- Produce what the prompt explicitly asks for — named sections, tables, lists, and deliverables — directly and in full.
- You may include background context, tangential analysis, and supporting detail where it strengthens the answer, but do not open with or pad the output with summaries of that background (no generic company overview, situation recap, industry primer, or key-takeaways preamble unless the prompt explicitly requests one).
- Do not recap source documents or restate obvious context the user already supplied; go straight to the requested substance.
- Prefer **answer-first** structure: tables and bullets with numbers/dates first; explanatory prose after the fact block when needed.
- Scoring favors **density of new credit-relevant facts**, not length or repetition of baseline company/industry context.`;

const DIRECT_OUTPUT_MARKER = "output discipline (required)";

/** Idempotent: safe to call multiple times on the same string. */
export function withDirectOutputInstruction(prompt: string): string {
  const trimmed = prompt.trimEnd();
  if (!trimmed) return prompt;
  if (trimmed.toLowerCase().includes(DIRECT_OUTPUT_MARKER)) {
    return prompt;
  }
  return `${trimmed}${LLM_DIRECT_OUTPUT_INSTRUCTION}`;
}
