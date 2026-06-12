import { isPrivateWorkspaceKey } from "@/lib/company-workspace-key";
import { readUserTickerDocument, writeUserTickerDocument } from "@/lib/user-workspace-store";

export const PRIVATE_WORKSPACE_META_KEY = "private-workspace-meta";

export type PrivateWorkspaceMeta = {
  displayName: string;
};

export async function readPrivateWorkspaceMeta(
  userId: string,
  workspaceKey: string
): Promise<PrivateWorkspaceMeta | null> {
  if (!isPrivateWorkspaceKey(workspaceKey)) return null;
  const raw = await readUserTickerDocument(userId, workspaceKey, PRIVATE_WORKSPACE_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PrivateWorkspaceMeta;
    const displayName = typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
    if (displayName) return { displayName };
  } catch {
    // ignore corrupt meta
  }
  return null;
}

export async function writePrivateWorkspaceMeta(
  userId: string,
  workspaceKey: string,
  displayName: string
): Promise<boolean> {
  const name = displayName.trim();
  if (!name || !isPrivateWorkspaceKey(workspaceKey)) return false;
  const result = await writeUserTickerDocument(
    userId,
    workspaceKey,
    PRIVATE_WORKSPACE_META_KEY,
    JSON.stringify({ displayName: name } satisfies PrivateWorkspaceMeta)
  );
  return result.ok;
}
