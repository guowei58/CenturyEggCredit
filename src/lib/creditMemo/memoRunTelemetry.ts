import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";

/**
 * Split the memo/deck user message into task+inventory+headers vs evidence body vs closing (---).
 * Prefers the `# EVIDENCE` marker so inventory text cannot accidentally match the evidence body first.
 */
export function computeMemoUserMessageBreakdown(user: string, evidence: string): LmeUserMessageCharBreakdown {
  const marker = "\n# EVIDENCE\n";
  const j = user.indexOf(marker);
  if (j >= 0) {
    const bodyStart = j + marker.length;
    if (user.slice(bodyStart, bodyStart + evidence.length) === evidence) {
      const head = user.slice(0, bodyStart);
      const tail = user.slice(bodyStart + evidence.length);
      return {
        taskSpecChars: head.length,
        bridgeChars: tail.length,
        formattedSourcesChars: evidence.length,
        totalUserMessageChars: user.length,
      };
    }
  }
  const n = user.indexOf(evidence);
  if (n < 0) {
    return {
      taskSpecChars: user.length,
      bridgeChars: 0,
      formattedSourcesChars: 0,
      totalUserMessageChars: user.length,
    };
  }
  return {
    taskSpecChars: n,
    bridgeChars: user.length - n - evidence.length,
    formattedSourcesChars: evidence.length,
    totalUserMessageChars: user.length,
  };
}
