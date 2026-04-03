import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";
import type { NormalizedXPost, XSourceProviderId } from "./types";

const SUBDIR = "X Search/x-search-posts.jsonl";

export type PersistedXPost = {
  savedAtIso: string;
  provider: XSourceProviderId;
  query: string;
  ticker: string;
  companyName?: string;
  post: NormalizedXPost;
};

export async function appendPostsToLocalDb(params: {
  userId: string;
  ticker: string;
  companyName?: string;
  provider: XSourceProviderId;
  query: string;
  posts: NormalizedXPost[];
}): Promise<void> {
  const safe = sanitizeTicker(params.ticker);
  if (!safe) return;
  const now = new Date().toISOString();
  const lines = params.posts.map((p) =>
    JSON.stringify({
      savedAtIso: now,
      provider: params.provider,
      query: params.query,
      ticker: safe,
      companyName: params.companyName,
      post: p,
    } satisfies PersistedXPost)
  );
  const chunk = lines.join("\n") + (lines.length ? "\n" : "");
  const prev = (await workspaceReadUtf8(params.userId, safe, SUBDIR)) ?? "";
  await workspaceWriteUtf8(params.userId, safe, SUBDIR, prev + chunk);
}
