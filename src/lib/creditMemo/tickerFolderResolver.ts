import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";

import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { USER_WORKSPACE_INGEST_SENTINEL } from "@/lib/user-ticker-workspace-constants";
import { hasUserTickerServerIngestSources } from "@/lib/user-workspace-store";
import type { FolderCandidate, FolderResolveResult } from "./types";
import { getResearchRootResolved } from "./config";

function normToken(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function scoreFolderName(ticker: string, folderName: string): { score: number; matchType: string; reasons: string[] } {
  const tk = ticker.toUpperCase();
  const tkNorm = normToken(tk);
  const name = folderName.trim();
  const nameNorm = normToken(name);
  const reasons: string[] = [];
  let score = 0;
  let matchType = "weak";

  if (name.toUpperCase() === tk) {
    score = 100;
    matchType = "exact_case_insensitive";
    reasons.push("Folder name equals ticker");
    return { score, matchType, reasons };
  }

  const upper = name.toUpperCase();
  const prefixes = [`${tk} - `, `${tk}-`, `${tk}_`, `${tk} `, `[${tk}]`];
  for (const p of prefixes) {
    if (
      upper.startsWith(p.toUpperCase().replace(/ /g, "")) ||
      upper.startsWith(tk + " -") ||
      upper.startsWith(tk + "_")
    ) {
      score = 95;
      matchType = "ticker_prefix";
      reasons.push(`Folder starts with ticker prefix (${p.trim()})`);
      return { score, matchType, reasons };
    }
  }
  if (upper.startsWith(`${tk} -`) || upper.startsWith(`${tk}_`) || upper.startsWith(`${tk} (`)) {
    score = 95;
    matchType = "ticker_prefix";
    reasons.push("Folder starts with ticker and separator");
    return { score, matchType, reasons };
  }

  const firstWord = name.split(/[\s._-]+/)[0]?.toUpperCase() ?? "";
  if (firstWord === tk) {
    score = 90;
    matchType = "first_token";
    reasons.push("First token matches ticker");
    return { score, matchType, reasons };
  }

  if (nameNorm.includes(tkNorm) && tkNorm.length >= 2) {
    score = 80;
    matchType = "normalized_contains";
    reasons.push("Normalized folder name contains ticker");
    return { score, matchType, reasons };
  }

  const tokens = name.split(/[\s._\-/,]+/).filter(Boolean);
  if (tokens.some((t) => normToken(t) === tkNorm)) {
    score = 75;
    matchType = "token_match";
    reasons.push("A folder word matches ticker");
    return { score, matchType, reasons };
  }

  reasons.push("Low or no match");
  return { score, matchType, reasons };
}

async function listSubdirs(absRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(absRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    out.push(e.name);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

function sortCandidates(a: FolderCandidate, b: FolderCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.folderName.length - b.folderName.length;
}

/**
 * Resolve research folder under RESEARCH_ROOT_DIR and/or logged-in user's cloud workspace (Postgres).
 */
export async function resolveTickerFolder(
  tickerRaw: string,
  userId?: string | null
): Promise<FolderResolveResult> {
  const ticker = sanitizeTicker(tickerRaw);
  if (!ticker) {
    return {
      ok: false,
      rootSearched: "",
      candidates: [],
      error: "Invalid ticker symbol.",
    };
  }

  const researchRoot = getResearchRootResolved();
  const allCandidates: FolderCandidate[] = [];
  let researchRootUnreachable: string | null = null;

  if (researchRoot) {
    let rootOk = false;
    try {
      await fs.access(researchRoot);
      rootOk = true;
    } catch {
      researchRootUnreachable = researchRoot;
    }
    if (rootOk) {
      const subs = await listSubdirs(researchRoot);
      for (const name of subs) {
        const { score, matchType, reasons } = scoreFolderName(ticker, name);
        if (score < 40) continue;
        allCandidates.push({
          path: path.join(researchRoot, name),
          folderName: name,
          score,
          matchType,
          reasons,
        });
      }
    }
  }

  if (userId && (await hasUserTickerServerIngestSources(userId, ticker))) {
    allCandidates.push({
      path: USER_WORKSPACE_INGEST_SENTINEL,
      folderName: "Cloud workspace (your app files)",
      score: researchRoot ? 92 : 100,
      matchType: "app_user_workspace",
      reasons: [
        "Workspace files, saved tab text, and/or Saved Documents in your account for this ticker",
      ],
      virtual: "user_workspace",
    });
  }

  allCandidates.sort(sortCandidates);
  const seenPath = new Set<string>();
  const deduped = allCandidates.filter((c) => {
    const k = c.virtual ? `virt:${c.path}` : path.resolve(c.path);
    if (seenPath.has(k)) return false;
    seenPath.add(k);
    return true;
  });
  allCandidates.length = 0;
  allCandidates.push(...deduped);
  allCandidates.sort(sortCandidates);

  const rootsLabel = researchRootUnreachable
    ? `${researchRootUnreachable} (not reachable)${userId ? " + cloud workspace" : ""}`
    : researchRoot
      ? `${researchRoot}${userId ? " + cloud workspace" : ""}`
      : userId
        ? "cloud workspace (signed in)"
        : "(set RESEARCH_ROOT_DIR or sign in and add files for this ticker)";

  if (allCandidates.length === 0) {
    const err = researchRootUnreachable
      ? `RESEARCH_ROOT_DIR is not accessible (${researchRootUnreachable}). Sign in and add workspace files, saved tabs, or Saved Documents for ${ticker}, or fix the path.`
      : !researchRoot
        ? `No ingest source found. Set RESEARCH_ROOT_DIR to your research folder, or sign in and save tabs / documents for ${ticker} in the app.`
        : `No subfolder under ${researchRoot} matched ticker ${ticker} (min score 40), and no cloud workspace data for your account.`;

    return {
      ok: false,
      rootSearched: rootsLabel,
      candidates: [],
      error: err,
    };
  }

  const best = allCandidates[0]!;
  const second = allCandidates[1];

  if (second && best.score - second.score < 5 && best.score < 98) {
    return {
      ok: false,
      rootSearched: rootsLabel,
      candidates: allCandidates.slice(0, 12),
      error: "Multiple folders match closely. Pick the correct folder in the UI (folder names shown below).",
    };
  }

  const strongEnough =
    best.score >= 55 || best.matchType === "app_user_workspace" || best.matchType === "exact_case_insensitive";

  if (!strongEnough) {
    return {
      ok: false,
      rootSearched: rootsLabel,
      candidates: allCandidates.slice(0, 12),
      error: "No strong folder match. Review candidates below and select manually.",
    };
  }

  return {
    ok: true,
    rootSearched: rootsLabel,
    chosen: best,
    alternates: allCandidates.filter((c) => c.path !== best.path).slice(0, 11),
  };
}
