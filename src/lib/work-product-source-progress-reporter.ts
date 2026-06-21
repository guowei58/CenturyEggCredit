import {
  setWorkProductSourceProgress,
  type WorkProductSourceProgressPhase,
} from "@/lib/work-product-source-progress";

export type SourceGatherProgressReporter = (update: {
  phase: WorkProductSourceProgressPhase;
  detail: string;
  done?: number;
  total?: number;
}) => void;

export function reporterFromKey(progressKey?: string): SourceGatherProgressReporter | undefined {
  if (!progressKey) return undefined;
  return (update) => {
    setWorkProductSourceProgress(progressKey, {
      phase: update.phase,
      detail: update.detail,
      done: update.done ?? 0,
      total: update.total ?? 0,
    });
  };
}

export function progressFilename(label: string): string {
  const trimmed = label.trim();
  const slash = trimmed.lastIndexOf("/");
  const backslash = trimmed.lastIndexOf("\\");
  const idx = Math.max(slash, backslash);
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export async function runExtractLoop(
  reporter: SourceGatherProgressReporter | undefined,
  phase: "extracting" | "extras",
  items: Array<{ label: string; run: () => Promise<void> }>
): Promise<void> {
  if (!items.length) return;
  const prefix = phase === "extras" ? "Extra sources" : "Extracting";
  for (let i = 0; i < items.length; i++) {
    const name = progressFilename(items[i].label);
    reporter?.({
      phase,
      detail: `${prefix} ${i + 1}/${items.length}: ${name}…`,
      done: i,
      total: items.length,
    });
    await items[i].run();
  }
  reporter?.({
    phase,
    detail: `${prefix} ${items.length}/${items.length}: done`,
    done: items.length,
    total: items.length,
  });
}
