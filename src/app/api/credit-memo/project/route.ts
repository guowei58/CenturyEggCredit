import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { createProjectId, ingestTickerFolder } from "@/lib/creditMemo/folderIngest";
import { mergeAiChatIntoIngestedProject } from "@/lib/creditMemo/mergeAiChatSources";
import { isAllowedTickerResearchPath } from "@/lib/creditMemo/pathGuard";
import { saveProject } from "@/lib/creditMemo/store";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { getAiChatPayload } from "@/lib/user-workspace-store";
import { USER_WORKSPACE_INGEST_SENTINEL } from "@/lib/user-ticker-workspace-constants";
import {
  materializeUserWorkspaceToTempDir,
  rmTempWorkspaceDir,
} from "@/lib/user-ticker-workspace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * POST { ticker, folderPath, resolutionMeta? }
 * folderPath may be USER_WORKSPACE_INGEST_SENTINEL to materialize Postgres workspace to OS temp.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string; folderPath?: string; resolutionMeta?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sym = sanitizeTicker(typeof body.ticker === "string" ? body.ticker : "");
  if (!sym) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const folderPath = typeof body.folderPath === "string" ? body.folderPath.trim() : "";
  if (!folderPath) {
    return NextResponse.json({ error: "folderPath required (from resolve step)" }, { status: 400 });
  }

  let tmpMaterialized: string | null = null;
  let abs: string;
  let projectId: string;

  try {
    if (folderPath === USER_WORKSPACE_INGEST_SENTINEL) {
      tmpMaterialized = await materializeUserWorkspaceToTempDir(userId, sym);
      abs = tmpMaterialized;
      projectId = createProjectId(sym, abs, { userWorkspaceUserId: userId });
    } else {
      abs = path.resolve(folderPath);
      if (!isAllowedTickerResearchPath(sym, abs)) {
        return NextResponse.json(
          {
            error:
              "folderPath must be under RESEARCH_ROOT_DIR or your cloud workspace export. No arbitrary paths.",
          },
          { status: 403 }
        );
      }
      projectId = createProjectId(sym, abs);
    }

    try {
      const st = await fs.stat(abs);
      if (!st.isDirectory()) {
        return NextResponse.json({ error: "folderPath is not a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Folder not found or not accessible" }, { status: 404 });
    }

    const { project: folderProject, warnings } = await ingestTickerFolder({
      projectId,
      ticker: sym,
      folderAbs: abs,
    });

    const chatPayload = await getAiChatPayload(userId, sym);
    const { project: mergedProject, extraWarnings } = mergeAiChatIntoIngestedProject(folderProject, chatPayload);
    const project = mergedProject;
    project.folderResolutionJson = body.resolutionMeta ?? { folderPath: abs };

    await saveProject(userId, project);

    return NextResponse.json({
      ok: true,
      project,
      ingestWarnings: [...warnings, ...extraWarnings],
    });
  } catch (e) {
    console.error("credit-memo project ingest error:", e);
    const msg = e instanceof Error ? e.message : "Internal server error during ingest";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    if (tmpMaterialized) await rmTempWorkspaceDir(tmpMaterialized);
  }
}
