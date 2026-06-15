import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

const SYSTEM_BANNER = "=== SYSTEM INSTRUCTIONS ===";
const USER_BANNER = "=== USER MESSAGE (task + source pack) ===";

/** Single blob for copy / Open in Claude / ChatGPT when the chat UI has one input. */
export function formatWorkProductPromptForExternalCopy(systemPrompt: string, userPrompt: string): string {
  const system = systemPrompt.trim();
  const user = userPrompt.trim();
  if (!system) return withPromptBenchmarkNotice(user);
  if (!user) return withPromptBenchmarkNotice(system);
  return withPromptBenchmarkNotice(`${SYSTEM_BANNER}\n\n${system}\n\n${USER_BANNER}\n\n${user}`);
}
