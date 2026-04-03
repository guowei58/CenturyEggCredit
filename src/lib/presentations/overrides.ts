/**
 * Server-side per-user per-ticker website override (Postgres workspace, account-global JSON).
 */

import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";

const REL_PATH = "presentations-site-overrides.json";

async function readOverrides(userId: string): Promise<Record<string, string>> {
  const raw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, REL_PATH);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null ? (data as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeOverrides(userId: string, data: Record<string, string>): Promise<void> {
  await workspaceWriteUtf8(userId, WORKSPACE_GLOBAL_TICKER, REL_PATH, JSON.stringify(data, null, 2));
}

export async function getOverride(userId: string, ticker: string): Promise<string | null> {
  const key = ticker.trim().toUpperCase();
  if (!key) return null;
  const data = await readOverrides(userId);
  const url = data[key];
  return url && url.startsWith("http") ? url : null;
}

export async function setOverride(userId: string, ticker: string, website: string | null): Promise<void> {
  const key = ticker.trim().toUpperCase();
  if (!key) return;
  const data = await readOverrides(userId);
  if (website?.trim() && website.startsWith("http")) {
    data[key] = website.trim();
  } else {
    delete data[key];
  }
  await writeOverrides(userId, data);
}
