/**
 * User-selected extra ingestion sources for Work Product tabs.
 * Defaults stay tab-specific; users can add saved tabs, Saved Documents, or workspace files.
 */

import { prisma } from "@/lib/prisma";
import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { buildMemoDeckIngestAllowSet, isMemoDeckLibraryWorkspacePath } from "@/lib/creditMemo/workProductIngestScope";
import { materializedSavedDocumentRelPath } from "@/lib/lme-saved-documents-filter";
import { isWorkspaceSpreadsheetFilename } from "@/lib/kpi-workspace-sources";
import { type LmeRawDocument } from "@/lib/lme-sources";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";
import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import { listAllUserSavedDocumentsBodiesForIngest, listUserTickerDocuments } from "@/lib/user-workspace-store";
import {
  USER_SAVED_DOCUMENTS_MATERIALIZE_DIR,
  workspaceReadFile,
} from "@/lib/user-ticker-workspace-store";
import {
  progressFilename,
  reporterFromKey,
  type SourceGatherProgressReporter,
} from "@/lib/work-product-source-progress-reporter";

export type WorkProductIngestTabKind =
  | "kpi"
  | "lme"
  | "forensic"
  | "recommendation"
  | "literary"
  | "biblical"
  | "dumbass"
  | "earnings-transcript"
  | "memo";

export const WORK_PRODUCT_INGEST_TAB_KINDS = new Set<WorkProductIngestTabKind>([
  "kpi",
  "lme",
  "forensic",
  "recommendation",
  "literary",
  "biblical",
  "dumbass",
  "earnings-transcript",
  "memo",
]);

export function isWorkProductIngestTabKind(raw: string): raw is WorkProductIngestTabKind {
  return WORK_PRODUCT_INGEST_TAB_KINDS.has(raw as WorkProductIngestTabKind);
}

export const WORK_PRODUCT_INGEST_ADDITIONS_SAVE_KEY = "work-product-ingest-additions" as const;

/** Stable id: `tab:{dataKey}` | `doc:{savedDocumentFilename}` | `ws:{workspaceRelPath}` */
export type WorkProductIngestSourceId = string;

export type WorkProductIngestCatalogEntry = {
  id: WorkProductIngestSourceId;
  label: string;
  category: "saved_tab" | "work_product" | "saved_document" | "workspace_file";
  filename: string;
  charsEstimate: number;
  /** Included by the tab's built-in rules (not removable here). */
  isDefault: boolean;
  /** Explicitly added by the user for this tab. */
  isUserAdded: boolean;
};

export type WorkProductIngestCatalog = {
  kind: WorkProductIngestTabKind;
  ticker: string;
  defaultSourceIds: WorkProductIngestSourceId[];
  /** Extra sources currently ingested for this tab (after Refresh sources). */
  userAddedSourceIds: WorkProductIngestSourceId[];
  /** Saved picker selection — applied only when the user clicks Refresh sources. */
  pendingSourceIds: WorkProductIngestSourceId[];
  hasUnappliedPending: boolean;
  entries: WorkProductIngestCatalogEntry[];
};

type TabAdditionsState = {
  applied: WorkProductIngestSourceId[];
  pending: WorkProductIngestSourceId[];
};

type AdditionsFile = Partial<Record<WorkProductIngestTabKind, WorkProductIngestSourceId[] | TabAdditionsState>>;

function isValidSourceId(id: unknown): id is WorkProductIngestSourceId {
  return typeof id === "string" && id.includes(":");
}

function dedupeSourceIds(ids: WorkProductIngestSourceId[]): WorkProductIngestSourceId[] {
  return [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
}

function normalizeTabAdditions(
  raw: WorkProductIngestSourceId[] | TabAdditionsState | undefined
): TabAdditionsState {
  if (!raw) return { applied: [], pending: [] };
  if (Array.isArray(raw)) {
    const applied = dedupeSourceIds(raw.filter(isValidSourceId));
    return { applied, pending: [...applied] };
  }
  const applied = dedupeSourceIds((raw.applied ?? []).filter(isValidSourceId));
  const pending = dedupeSourceIds((raw.pending ?? applied).filter(isValidSourceId));
  return { applied, pending };
}

function tabAdditionsEqual(a: WorkProductIngestSourceId[], b: WorkProductIngestSourceId[]): boolean {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

function readTabAdditions(file: AdditionsFile, kind: WorkProductIngestTabKind): TabAdditionsState {
  return normalizeTabAdditions(file[kind]);
}

const INTERNAL_TAB_SUFFIXES = ["-meta", "-source-pack"] as const;

const INTERNAL_TAB_KEYS = new Set([
  WORK_PRODUCT_INGEST_ADDITIONS_SAVE_KEY,
  "competitor-earnings-readthrus-inputs",
  "credit-decision-dashboard-inputs",
  "private-workspace-meta",
  "xbrl-deterministic-compiler-result",
  "entity-mapper-v2-snapshot",
  "ai-memo-deck-built-prompt-cache",
]);

const WORK_PRODUCT_TAB_KEYS = new Set([
  "kpi-latest",
  "forensic-accounting-latest",
  "lme-analysis",
  "cs-recommendation-latest",
  "literary-references-latest",
  "biblical-references-latest",
  "how-to-look-like-a-dumbass-latest",
  "next-quarter-earnings-transcript-latest",
  "ai-credit-deck",
  "covenants-synthesis",
  "xbrl-consolidated-financials-ai",
]);

const SELF_TAB_KEY_BY_KIND: Partial<Record<WorkProductIngestTabKind, string>> = {
  kpi: "kpi-latest",
  lme: "lme-analysis",
  forensic: "forensic-accounting-latest",
  recommendation: "cs-recommendation-latest",
  literary: "literary-references-latest",
  biblical: "biblical-references-latest",
  dumbass: "how-to-look-like-a-dumbass-latest",
  "earnings-transcript": "next-quarter-earnings-transcript-latest",
  memo: "ai-credit-deck",
};

const FILENAME_TO_TAB_DATA_KEY = new Map<string, string>(
  Object.entries(SAVED_DATA_FILES).map(([key, fn]) => [fn.trim().toLowerCase(), key])
);

export function normalizeIngestRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function sourceIdToMaterializedRelPath(sourceId: WorkProductIngestSourceId): string | null {
  if (sourceId.startsWith("tab:")) {
    const dataKey = sourceId.slice(4);
    if (!(dataKey in SAVED_DATA_FILES)) return null;
    return SAVED_DATA_FILES[dataKey as keyof typeof SAVED_DATA_FILES];
  }
  if (sourceId.startsWith("doc:")) {
    const fn = sourceId.slice(4).trim();
    if (!fn) return null;
    return materializedSavedDocumentRelPath(fn);
  }
  if (sourceId.startsWith("ws:")) {
    const rel = normalizeWsPath(sourceId.slice(3));
    return rel || null;
  }
  return null;
}

export function relPathToSourceId(relPath: string): WorkProductIngestSourceId | null {
  const norm = normalizeWsPath(relPath);
  const normLower = norm.toLowerCase();
  const savedPrefix = `${USER_SAVED_DOCUMENTS_MATERIALIZE_DIR}/`.toLowerCase();
  if (normLower.startsWith(savedPrefix)) {
    return docSourceId(norm.slice(USER_SAVED_DOCUMENTS_MATERIALIZE_DIR.length + 1));
  }
  if (!norm.includes("/")) {
    const dataKey = FILENAME_TO_TAB_DATA_KEY.get(normLower);
    if (dataKey) return tabSourceId(dataKey);
  }
  return wsSourceId(norm);
}

export async function listMaterializedWorkspaceRelPaths(userId: string, ticker: string): Promise<string[]> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  const out = new Set<string>();

  const tabRows = await listUserTickerDocuments(userId, sym);
  for (const row of tabRows) {
    if (!(row.dataKey in SAVED_DATA_FILES)) continue;
    if (!row.content?.trim()) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    out.add(fn);
  }

  const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
  for (const { filename } of savedDocs) {
    const fn = filename.trim();
    if (fn) out.add(materializedSavedDocumentRelPath(fn));
  }

  const wsRows = await prisma.userTickerWorkspaceFile.findMany({
    where: { userId, ticker: sym },
    select: { path: true },
  });
  for (const row of wsRows) {
    const rel = normalizeWsPath(row.path);
    if (rel) out.add(rel);
  }

  return [...out];
}

export async function memoDeckDefaultSourceIds(
  userId: string,
  ticker: string
): Promise<WorkProductIngestSourceId[]> {
  const paths = await listMaterializedWorkspaceRelPaths(userId, ticker);
  const allow = buildMemoDeckIngestAllowSet(paths);
  const ids: WorkProductIngestSourceId[] = [];
  for (const rel of paths) {
    if (!allow.has(normalizeIngestRelPath(rel))) continue;
    const id = relPathToSourceId(rel);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** AI Memo & Deck folder ingest allowlist plus user-selected extras. */
export async function mergeMemoDeckIngestAllowSet(
  allRelPaths: string[],
  ticker: string,
  userId: string
): Promise<Set<string>> {
  const allow = buildMemoDeckIngestAllowSet(allRelPaths);
  const pathNorms = new Set(allRelPaths.map((rel) => normalizeIngestRelPath(rel)));
  const added = await readUserAddedSourceIds("memo", ticker, userId);
  for (const sourceId of added) {
    const rel = sourceIdToMaterializedRelPath(sourceId);
    if (!rel) continue;
    const norm = normalizeIngestRelPath(rel);
    if (pathNorms.has(norm)) allow.add(norm);
  }
  return allow;
}

function isInternalTabKey(dataKey: string): boolean {
  if (INTERNAL_TAB_KEYS.has(dataKey)) return true;
  return INTERNAL_TAB_SUFFIXES.some((s) => dataKey.endsWith(s));
}

function isPickableTabKey(dataKey: string, kind: WorkProductIngestTabKind): boolean {
  if (!(dataKey in SAVED_DATA_FILES)) return false;
  if (isInternalTabKey(dataKey)) return false;
  if (dataKey === SELF_TAB_KEY_BY_KIND[kind]) return false;
  if (dataKey.startsWith("ai-credit-memo-") && dataKey.endsWith("-meta")) return false;
  if (dataKey.startsWith("ai-credit-memo-") && dataKey.endsWith("-source-pack")) return false;
  return true;
}

function normalizeWsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isPickableWorkspacePath(relPath: string): boolean {
  const n = normalizeWsPath(relPath).toLowerCase();
  if (!n) return false;
  if (n.startsWith("credit-memo/")) return false;
  if (isMemoDeckLibraryWorkspacePath(relPath)) return false;
  if (n.includes("lme-retrieval-embeddings") || n.includes("kpi-embeddings")) return false;
  return true;
}

export function tabSourceId(dataKey: string): WorkProductIngestSourceId {
  return `tab:${dataKey}`;
}

export function docSourceId(filename: string): WorkProductIngestSourceId {
  return `doc:${filename.trim()}`;
}

export function wsSourceId(relPath: string): WorkProductIngestSourceId {
  return `ws:${normalizeWsPath(relPath)}`;
}

/** Same extraction path as ingest — not raw file bytes (HTML/PDF markup is stripped). */
async function estimateIngestableCharCount(filename: string, body: Buffer): Promise<number> {
  try {
    const extracted = (await extractBytesForAi(filename, body)).trim();
    if (!extracted || extracted.startsWith("[")) return 0;
    return extracted.length;
  } catch {
    return 0;
  }
}

export function sourceIdFromRawDoc(doc: LmeRawDocument): WorkProductIngestSourceId | null {
  if (doc.key) return tabSourceId(doc.key);
  const file = doc.file?.trim();
  if (!file) return null;
  if (doc.label.startsWith("Saved Documents")) return docSourceId(file);
  if (file.includes("/") || doc.label.includes("Uploaded") || doc.label.includes("Excel")) {
    return wsSourceId(file);
  }
  return docSourceId(file);
}

export async function readWorkProductIngestAdditionsFile(
  ticker: string,
  userId: string
): Promise<AdditionsFile> {
  const raw = (await readSavedContent(ticker, WORK_PRODUCT_INGEST_ADDITIONS_SAVE_KEY, userId))?.trim() ?? "";
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as AdditionsFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function readUserAddedSourceIds(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string
): Promise<WorkProductIngestSourceId[]> {
  const file = await readWorkProductIngestAdditionsFile(ticker, userId);
  return readTabAdditions(file, kind).applied;
}

export async function readPendingUserAddedSourceIds(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string
): Promise<WorkProductIngestSourceId[]> {
  const file = await readWorkProductIngestAdditionsFile(ticker, userId);
  return readTabAdditions(file, kind).pending;
}

export async function writePendingUserAddedSourceIds(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string,
  sourceIds: WorkProductIngestSourceId[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = await readWorkProductIngestAdditionsFile(ticker, userId);
  const state = readTabAdditions(file, kind);
  file[kind] = {
    applied: state.applied,
    pending: dedupeSourceIds(sourceIds.filter(isValidSourceId)),
  };
  const payload = JSON.stringify(file, null, 2);
  return writeSavedContent(ticker, WORK_PRODUCT_INGEST_ADDITIONS_SAVE_KEY, payload, userId);
}

/** Copy pending picker selections into the applied set used by source gather / ingest. */
export async function applyPendingUserAddedSourceIds(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string
): Promise<
  { ok: true; applied: WorkProductIngestSourceId[]; unchanged: boolean } | { ok: false; error: string }
> {
  const file = await readWorkProductIngestAdditionsFile(ticker, userId);
  const state = readTabAdditions(file, kind);
  if (tabAdditionsEqual(state.applied, state.pending)) {
    return { ok: true, applied: state.applied, unchanged: true };
  }
  const applied = dedupeSourceIds(state.pending.filter(isValidSourceId));
  file[kind] = { applied, pending: [...applied] };
  const payload = JSON.stringify(file, null, 2);
  const saved = await writeSavedContent(ticker, WORK_PRODUCT_INGEST_ADDITIONS_SAVE_KEY, payload, userId);
  if (!saved.ok) return saved;
  return { ok: true, applied, unchanged: false };
}

/** @deprecated Use writePendingUserAddedSourceIds — kept for callers that commit immediately. */
export async function writeUserAddedSourceIds(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string,
  sourceIds: WorkProductIngestSourceId[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = await readWorkProductIngestAdditionsFile(ticker, userId);
  const deduped = dedupeSourceIds(sourceIds.filter(isValidSourceId));
  file[kind] = { applied: deduped, pending: [...deduped] };
  const payload = JSON.stringify(file, null, 2);
  return writeSavedContent(ticker, WORK_PRODUCT_INGEST_ADDITIONS_SAVE_KEY, payload, userId);
}

let extraDocCounter = 0;
function nextExtraDocId(): string {
  extraDocCounter += 1;
  return `wp-add-${extraDocCounter.toString(36)}`;
}

async function resolveIngestSourceToRawDocument(
  sourceId: WorkProductIngestSourceId,
  ticker: string,
  userId: string,
  seq: number,
  caches?: {
    savedDocsByFilename?: Map<string, Buffer>;
  }
): Promise<LmeRawDocument | null> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  const maxBytes = loadCreditMemoConfig().maxIngestFileBytes;

  if (sourceId.startsWith("tab:")) {
    const dataKey = sourceId.slice(4);
    if (!(dataKey in SAVED_DATA_FILES)) return null;
    const raw = (await readSavedContent(ticker, dataKey, userId))?.trim() ?? "";
    if (!raw || raw.length < 2) return null;
    const fn = SAVED_DATA_FILES[dataKey as keyof typeof SAVED_DATA_FILES];
    return {
      docId: nextExtraDocId(),
      tier: 0,
      seq,
      label: `Added — Saved tab: ${fn}`,
      key: dataKey,
      file: fn,
      raw,
    };
  }

  if (sourceId.startsWith("doc:")) {
    const filename = sourceId.slice(4).trim();
    if (!filename) return null;
    let body: Buffer | undefined = caches?.savedDocsByFilename?.get(filename);
    if (!body) {
      const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
      body = savedDocs.find((d) => d.filename.trim() === filename)?.body;
    }
    if (!body || body.length > maxBytes) return null;
    if (isWorkspaceSpreadsheetFilename(filename)) return null;
    try {
      const extracted = (await extractBytesForAi(filename, body)).trim();
      if (!extracted) return null;
      return {
        docId: nextExtraDocId(),
        tier: 1,
        seq,
        label: `Added — Saved Documents: ${filename}`,
        file: filename,
        raw: extracted,
      };
    } catch {
      return null;
    }
  }

  if (sourceId.startsWith("ws:")) {
    const relPath = normalizeWsPath(sourceId.slice(3));
    if (!relPath || !isPickableWorkspacePath(relPath)) return null;
    try {
      const buf = await workspaceReadFile(userId, sym, relPath);
      if (!buf?.length || buf.length > maxBytes) return null;
      const base = relPath.split("/").pop() ?? relPath;
      const extracted = (await extractBytesForAi(base, buf)).trim();
      if (!extracted) return null;
      return {
        docId: nextExtraDocId(),
        tier: 2,
        seq,
        label: `Added — Workspace: ${relPath}`,
        file: relPath,
        raw: extracted,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function resolveUserAddedRawDocuments(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string,
  baseDocs: LmeRawDocument[],
  reporter?: SourceGatherProgressReporter
): Promise<LmeRawDocument[]> {
  extraDocCounter = 0;
  const sym = sanitizeTicker(ticker);
  const baseIds = new Set(
    baseDocs.map((d) => sourceIdFromRawDoc(d)).filter((id): id is WorkProductIngestSourceId => Boolean(id))
  );
  const userIds = await readUserAddedSourceIds(kind, ticker, userId);
  const pending = userIds.filter((id) => !baseIds.has(id));
  if (!pending.length) return [];

  reporter?.({ phase: "extras", detail: "Checking extra ingestion sources…", done: 0, total: pending.length });

  const needsSavedDocs = pending.some((id) => id.startsWith("doc:"));
  const savedDocsByFilename = needsSavedDocs && sym
    ? new Map(
        (await listAllUserSavedDocumentsBodiesForIngest(userId, sym)).map((d) => [d.filename.trim(), d.body] as const)
      )
    : undefined;
  const out: LmeRawDocument[] = [];
  let seq = 0;
  for (let i = 0; i < pending.length; i++) {
    const sourceId = pending[i];
    const needsExtract = sourceId.startsWith("doc:") || sourceId.startsWith("ws:");
    const label = progressFilename(sourceId.slice(sourceId.indexOf(":") + 1));
    reporter?.({
      phase: "extras",
      detail: needsExtract
        ? `Extra sources ${i + 1}/${pending.length}: ${label}…`
        : `Extra sources ${i + 1}/${pending.length}: ${label}`,
      done: i,
      total: pending.length,
    });
    const doc = await resolveIngestSourceToRawDocument(sourceId, ticker, userId, seq++, {
      savedDocsByFilename,
    });
    if (!doc) continue;
    const tier = tierForExtractedBody(doc.file ?? doc.label, doc.raw);
    out.push({ ...doc, tier });
  }
  if (pending.length > 0) {
    reporter?.({
      phase: "extras",
      detail: `Extra sources ${pending.length}/${pending.length}: done`,
      done: pending.length,
      total: pending.length,
    });
  }
  return out;
}

export async function collectWorkProductRawDocumentsWithAdditions(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string | null | undefined,
  collectBase: (reporter?: SourceGatherProgressReporter) => Promise<LmeRawDocument[]>,
  progressKey?: string
): Promise<LmeRawDocument[]> {
  const reporter = reporterFromKey(progressKey);
  reporter?.({ phase: "loading", detail: "Loading default sources…", done: 0, total: 0 });
  const base = await collectBase(reporter);
  if (!userId) return base;
  const added = await resolveUserAddedRawDocuments(kind, ticker, userId, base, reporter);
  return [...base, ...added];
}

function tabCategory(dataKey: string): WorkProductIngestCatalogEntry["category"] {
  if (WORK_PRODUCT_TAB_KEYS.has(dataKey) || dataKey.startsWith("ai-credit-memo-")) return "work_product";
  return "saved_tab";
}

function tabLabel(dataKey: string, filename: string): string {
  const pretty = dataKey.replace(/-/g, " ");
  return `${pretty} (${filename})`;
}

export async function buildWorkProductIngestCatalog(
  kind: WorkProductIngestTabKind,
  ticker: string,
  userId: string,
  baseDocs: LmeRawDocument[]
): Promise<WorkProductIngestCatalog> {
  const sym = sanitizeTicker(ticker);
  if (!sym) {
    return {
      kind,
      ticker,
      defaultSourceIds: [],
      userAddedSourceIds: [],
      pendingSourceIds: [],
      hasUnappliedPending: false,
      entries: [],
    };
  }

  const userAddedSourceIds = await readUserAddedSourceIds(kind, ticker, userId);
  const pendingSourceIds = await readPendingUserAddedSourceIds(kind, ticker, userId);
  const hasUnappliedPending = !tabAdditionsEqual(userAddedSourceIds, pendingSourceIds);
  const defaultSourceIds =
    kind === "memo"
      ? await memoDeckDefaultSourceIds(userId, sym)
      : [
          ...new Set(
            baseDocs
              .map((d) => sourceIdFromRawDoc(d))
              .filter((id): id is WorkProductIngestSourceId => Boolean(id))
          ),
        ];
  const defaultSet = new Set(defaultSourceIds);
  const userAddedSet = new Set(userAddedSourceIds);
  const extractEstimateIds = new Set([...userAddedSourceIds, ...pendingSourceIds]);

  const entryMap = new Map<WorkProductIngestSourceId, WorkProductIngestCatalogEntry>();

  const upsert = (entry: Omit<WorkProductIngestCatalogEntry, "isDefault" | "isUserAdded">) => {
    const isDefault = defaultSet.has(entry.id);
    const isUserAdded = userAddedSet.has(entry.id);
    entryMap.set(entry.id, { ...entry, isDefault, isUserAdded });
  };

  const tabRows = await listUserTickerDocuments(userId, sym);
  for (const row of tabRows) {
    if (!isPickableTabKey(row.dataKey, kind)) continue;
    const raw = row.content?.trim() ?? "";
    if (raw.length < 2) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    upsert({
      id: tabSourceId(row.dataKey),
      label: tabLabel(row.dataKey, fn),
      category: tabCategory(row.dataKey),
      filename: fn,
      charsEstimate: raw.length,
    });
  }

  const maxBytes = loadCreditMemoConfig().maxIngestFileBytes;
  const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
  for (const { filename, body } of savedDocs) {
    const fn = filename.trim();
    if (!fn || body.length > maxBytes) continue;
    const id = docSourceId(fn);
    const charsEstimate = extractEstimateIds.has(id)
      ? await estimateIngestableCharCount(fn, body)
      : body.length;
    if (charsEstimate < 2) continue;
    upsert({
      id,
      label: `Saved Document: ${fn}`,
      category: "saved_document",
      filename: fn,
      charsEstimate,
    });
  }

  const wsRows = await prisma.userTickerWorkspaceFile.findMany({
    where: { userId, ticker: sym },
    select: { path: true, body: true },
  });
  for (const row of wsRows) {
    const rel = normalizeWsPath(row.path);
    if (!isPickableWorkspacePath(rel)) continue;
    const body = row.body ? Buffer.from(row.body) : Buffer.alloc(0);
    if (body.length < 2 || body.length > maxBytes) continue;
    const base = rel.split("/").pop() ?? rel;
    const id = wsSourceId(rel);
    const charsEstimate = extractEstimateIds.has(id)
      ? await estimateIngestableCharCount(base, body)
      : body.length;
    if (charsEstimate < 2) continue;
    upsert({
      id,
      label: `Workspace file: ${rel}`,
      category: "workspace_file",
      filename: base,
      charsEstimate,
    });
  }

  for (const id of [...userAddedSourceIds, ...pendingSourceIds]) {
    if (entryMap.has(id)) continue;
    upsert({
      id,
      label: id,
      category: "saved_document",
      filename: id,
      charsEstimate: 0,
    });
  }

  const categoryOrder: Record<WorkProductIngestCatalogEntry["category"], number> = {
    work_product: 0,
    saved_tab: 1,
    saved_document: 2,
    workspace_file: 3,
  };

  const entries = [...entryMap.values()].sort((a, b) => {
    const rank = (e: WorkProductIngestCatalogEntry) =>
      e.isDefault ? 0 : e.isUserAdded ? 1 : 2;
    const rd = rank(a) - rank(b);
    if (rd !== 0) return rd;
    const cd = categoryOrder[a.category] - categoryOrder[b.category];
    if (cd !== 0) return cd;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  return {
    kind,
    ticker: sym,
    defaultSourceIds,
    userAddedSourceIds,
    pendingSourceIds,
    hasUnappliedPending,
    entries,
  };
}

export function validateUserAddedSourceIdsForKind(
  kind: WorkProductIngestTabKind,
  catalog: WorkProductIngestCatalog,
  requested: WorkProductIngestSourceId[]
): WorkProductIngestSourceId[] {
  const allowed = new Set(catalog.entries.map((e) => e.id));
  const defaultSet = new Set(catalog.defaultSourceIds);
  const selfKey = SELF_TAB_KEY_BY_KIND[kind];
  const out: WorkProductIngestSourceId[] = [];
  for (const id of requested) {
    const trimmed = id.trim();
    if (!trimmed || !allowed.has(trimmed)) continue;
    if (defaultSet.has(trimmed)) continue;
    if (selfKey && trimmed === tabSourceId(selfKey)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}
