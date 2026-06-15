import {
  formatWorkspaceBadge,
  isCikWorkspaceKey,
  isPrivateWorkspaceKey,
  privateWorkspaceDisplayName,
} from "@/lib/company-workspace-key";

/** Primary label for daily-news watchlist summary bullets and section headers. */
export function watchlistNewsDisplayLabel(workspaceKey: string, companyName?: string | null): string {
  const key = workspaceKey.trim();
  const name = companyName?.trim() ?? "";

  if (!isCikWorkspaceKey(key) && !isPrivateWorkspaceKey(key)) {
    return key.toUpperCase();
  }

  if (name && name.toUpperCase() !== key.toUpperCase()) {
    return name;
  }

  if (isPrivateWorkspaceKey(key)) {
    return privateWorkspaceDisplayName(key, name);
  }

  return formatWorkspaceBadge(key);
}

/** True when the watchlist row should use the monospace ticker chip (listed symbols only). */
export function usesTickerStyleNewsBadge(workspaceKey: string): boolean {
  const key = workspaceKey.trim();
  return !isCikWorkspaceKey(key) && !isPrivateWorkspaceKey(key);
}
