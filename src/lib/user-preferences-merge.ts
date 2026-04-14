import type { UserPreferencesData } from "@/lib/user-preferences-types";

/** Legacy fills gaps; server wins on overlaps. */
function mergeStringRecords(
  legacy: Record<string, string> | undefined,
  server: Record<string, string> | undefined
): Record<string, string> | undefined {
  const out: Record<string, string> = { ...legacy, ...server };
  return Object.keys(out).length ? out : undefined;
}

/** Prefer server values; fill missing keys from legacy. */
export function mergeLegacyIntoServerPrefs(
  server: UserPreferencesData,
  legacy: Partial<UserPreferencesData>
): UserPreferencesData {
  const next: UserPreferencesData = {
    ...server,
    migratedFromLocalStorage: true,
  };
  if (!server.aiProvider && legacy.aiProvider) next.aiProvider = legacy.aiProvider;

  next.aiModels = { ...legacy.aiModels, ...server.aiModels };
  if (!next.aiModels || Object.keys(next.aiModels).length === 0) delete next.aiModels;

  const pt = mergeStringRecords(legacy.promptTemplates, server.promptTemplates);
  if (pt) next.promptTemplates = pt;
  else delete next.promptTemplates;

  const fc = mergeStringRecords(legacy.feedCaches, server.feedCaches);
  if (fc) next.feedCaches = fc;
  else delete next.feedCaches;

  next.creditMemoDrafts = { ...legacy.creditMemoDrafts, ...server.creditMemoDrafts };
  if (!next.creditMemoDrafts || Object.keys(next.creditMemoDrafts).length === 0) delete next.creditMemoDrafts;

  if (server.includeOreoContext === undefined && legacy.includeOreoContext !== undefined) {
    next.includeOreoContext = legacy.includeOreoContext;
  }
  return next;
}
