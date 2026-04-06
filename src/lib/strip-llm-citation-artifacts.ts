/**
 * Removes citation placeholder tokens some models (notably ChatGPT with browsing)
 * leak into copied HTML, e.g. :contentReference[oaicite:0]{index=0}
 */

export function stripLlmCitationArtifacts(html: string): string {
  let s = html;
  // Bracket form: :contentReference[oaicite:0]{index=0}
  s = s.replace(/:contentReference\[[^\]]*\]\{[^}]*\}/g, "");
  // Pipe form: :contentReference|oaicite:0|{index=0}
  s = s.replace(/:contentReference\|oaicite:\d+\|\{index=\d+\}/gi, "");
  // Variants with extra pipes / spacing
  s = s.replace(/:contentReference\|\s*oaicite:\s*\d+\s*\|\s*\{index\s*=\s*\d+\}/gi, "");
  // Stray backticks sometimes wrap the token when pasted from ChatGPT UI
  s = s.replace(/`?\s*:contentReference\[[^\]]*\]\{[^}]*\}\s*`?/g, "");
  s = s.replace(/`?\s*:contentReference\|oaicite:\d+\|\{index=\d+\}\s*`?/gi, "");
  // Empty or whitespace-only table captions left after stripping
  s = s.replace(/<caption>\s*<\/caption>/gi, "");
  return s;
}
