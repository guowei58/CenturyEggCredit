import { auth } from "@/auth";
import {
  isPrivateWorkspaceKey,
  workspaceSearchCompanyName,
} from "@/lib/company-workspace-key";
import { readPrivateWorkspaceMeta } from "@/lib/private-workspace-meta";
import { getCompanyProfile } from "@/lib/sec-edgar";

/**
 * Resolve the company name to use in server-side search APIs.
 * Private workspaces never search as PRIV… keys; SEC lookup is skipped for them.
 */
export async function resolveCompanySearchName(
  workspaceKey: string,
  companyNameHint?: string | null
): Promise<string> {
  const key = workspaceKey.trim().toUpperCase();
  if (isPrivateWorkspaceKey(key)) {
    let stored = companyNameHint?.trim() || null;
    if (!stored) {
      const session = await auth();
      if (session?.user?.id) {
        const meta = await readPrivateWorkspaceMeta(session.user.id, key);
        stored = meta?.displayName?.trim() || null;
      }
    }
    return workspaceSearchCompanyName(key, stored);
  }

  const hint = companyNameHint?.trim();
  if (hint) return hint;

  try {
    const profile = await getCompanyProfile(key);
    if (profile?.name?.trim()) return profile.name.trim();
  } catch {
    // fall through
  }

  return key;
}
