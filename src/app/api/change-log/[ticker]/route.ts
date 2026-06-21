import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  collectPriorDedupeKeys,
  readChangeLogStore,
  writeChangeLogStore,
} from "@/lib/change-log/store";
import { computeChangeLogUpdatePeriod, isCalendarDateKeyInChangeLogPeriod } from "@/lib/change-log/period";
import type { ChangeLogEntry, ChangeLogSavedUpdate, ChangeLogStore } from "@/lib/change-log/types";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

/** GET — load Change Log store for ticker */
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const store = await readChangeLogStore(sym, userId);
  const period = computeChangeLogUpdatePeriod(new Date(), store.lastChangeLogUpdatedAt);

  return NextResponse.json({
    store,
    nextUpdatePeriod: {
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      periodLabel: period.periodLabel,
      isFirstUpdate: period.isFirstUpdate,
    },
  });
}

type PutBody = {
  action?: string;
  draft?: ChangeLogStore["draft"];
  /** Save completed update from draft or edited entries */
  saveUpdate?: {
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    entries: ChangeLogEntry[];
  };
  /** Discard in-progress draft without advancing last update timestamp */
  discardDraft?: boolean;
};

/** PUT — save draft edits, commit completed update, or discard draft */
export async function PUT(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const store = await readChangeLogStore(sym, userId);

  if (body.discardDraft) {
    store.draft = null;
    store.currentUpdateStartedAt = null;
    store.currentUpdateCompletedAt = null;
    const saved = await writeChangeLogStore(sym, userId, store);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ ok: true, store });
  }

  if (body.draft) {
    store.draft = body.draft;
    if (body.draft.status === "ready" && body.draft.completedAt) {
      store.currentUpdateCompletedAt = body.draft.completedAt;
    }
    const saved = await writeChangeLogStore(sym, userId, store);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ ok: true, store });
  }

  const saveUpdate = body.saveUpdate;
  if (!saveUpdate?.entries?.length) {
    return NextResponse.json({ error: "saveUpdate.entries required" }, { status: 400 });
  }

  const priorKeys = collectPriorDedupeKeys(store);
  const bounds = {
    periodStart: new Date(saveUpdate.periodStart),
    periodEnd: new Date(saveUpdate.periodEnd),
  };
  const entries = saveUpdate.entries.filter(
    (e) =>
      e.dedupeKey &&
      !priorKeys.has(e.dedupeKey) &&
      isCalendarDateKeyInChangeLogPeriod(e.date, bounds)
  );
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No new entries to save (all duplicates, out of period, or empty)" },
      { status: 400 }
    );
  }

  const savedAt = new Date().toISOString();
  const update: ChangeLogSavedUpdate = {
    id: randomUUID(),
    periodStart: saveUpdate.periodStart,
    periodEnd: saveUpdate.periodEnd,
    periodLabel: saveUpdate.periodLabel,
    savedAt,
    savedByUserId: userId,
    savedByUserEmail: typeof session.user?.email === "string" ? session.user.email : null,
    savedByUserName: typeof session.user?.name === "string" ? session.user.name : null,
    entries,
  };

  store.updates = [update, ...store.updates];
  store.lastChangeLogUpdatedAt = savedAt;
  store.currentUpdateStartedAt = null;
  store.currentUpdateCompletedAt = null;
  store.draft = null;

  const saved = await writeChangeLogStore(sym, userId, store);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ ok: true, store, savedUpdate: update });
}
