/**
 * Phase 6 placeholder: optional AI-assisted extraction for debt-map jobs.
 * Wire only after deterministic extraction; chunk prompts; require citations + confidence.
 */
export function debtMapAiAssistConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}
