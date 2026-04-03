import path from "path";

import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { getResearchRootResolved } from "./config";
import { isOsTempMaterializedWorkspacePath } from "@/lib/user-ticker-workspace-store";

/**
 * Allowed ingest roots: configured RESEARCH_ROOT_DIR, or OS temp dirs created for cloud workspace materialization.
 */
export function isAllowedTickerResearchPath(ticker: string, candidateAbs: string): boolean {
  const sym = sanitizeTicker(ticker);
  if (!sym) return false;
  const c = path.resolve(candidateAbs);
  const researchRoot = getResearchRootResolved();
  if (researchRoot) {
    const r = researchRoot + path.sep;
    if (c === researchRoot || c.startsWith(r)) return true;
  }
  if (isOsTempMaterializedWorkspacePath(c)) return true;
  return false;
}
