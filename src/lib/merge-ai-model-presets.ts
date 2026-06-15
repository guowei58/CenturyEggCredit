/**
 * Merge curated static presets with provider-discovered model ids (client + server).
 */

import type { ModelPreset } from "@/lib/ai-model-options";

/** Turn `gpt-4o-mini` → `GPT 4o mini` for discovered models without a display name. */
export function humanizeModelId(id: string): string {
  const base = id.replace(/^models\//, "");
  const parts = base.split(/[-_.:+/]/).filter(Boolean);
  return parts
    .map((p) => {
      if (/^v?\d+(\.\d+)*$/.test(p)) return p;
      if (/^gpt/i.test(p)) return p.toUpperCase().replace(/^GPT/, "GPT");
      if (/^claude/i.test(p)) return p.charAt(0).toUpperCase() + p.slice(1);
      if (/^gemini/i.test(p)) return p.charAt(0).toUpperCase() + p.slice(1);
      if (/^deepseek/i.test(p)) return "DeepSeek " + p.slice(8);
      if (/^o\d/.test(p)) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Curated presets first; append newly discovered ids not already listed. */
export function mergeModelPresets(base: ModelPreset[], discovered: ModelPreset[]): ModelPreset[] {
  const seen = new Set<string>();
  const out: ModelPreset[] = [];
  for (const p of base) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  const extras = discovered
    .filter((p) => p.id && !seen.has(p.id))
    .map((p) => ({
      id: p.id,
      label: p.label?.trim() || humanizeModelId(p.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  for (const p of extras) {
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
