/**
 * Persist limits for `PublicRecordsProfile` so large Exhibit 21 payloads
 * (many subsidiaries + wide grids) remain within practical DB / Prisma / request limits.
 */

import type { Exhibit21GridSnapshotV1 } from "@/lib/exhibit21GridSnapshot";
import { normalizeExhibit21MisalignedEntityColumn, parseExhibit21GridSnapshot } from "@/lib/exhibit21GridSnapshot";

export const PUBLIC_RECORDS_MAX_SUBSIDIARY_NAME_LIST = 6_500;
/** Hard cap row count — trim longest filings (e.g. rental / global lists) deterministically */
export const PUBLIC_RECORDS_MAX_EXHIBIT21_ROWS = 26_000;
export const PUBLIC_RECORDS_MAX_EXHIBIT21_CELL_CHARS = 8_000;
/** Typical platform / gateway limits — shrink grid until under without dropping entire snapshot */
export const PUBLIC_RECORDS_MAX_EXHIBIT21_JSON_UTF8_BYTES = 9_200_000;

function utf8JsonBytes(o: unknown): number {
  try {
    const s = JSON.stringify(o);
    return typeof s === "string" ? new TextEncoder().encode(s).length : 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function cloneJsonStrict<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Subsidiary search-name list persisted alongside Exhibit 21 (cap count + each string length). */
export function clampSubsidiaryNameList(names: string[]): string[] {
  const out: string[] = [];
  const maxItem = 600;
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    const truncated = t.length > maxItem ? `${t.slice(0, maxItem)}…` : t;
    out.push(truncated);
    if (out.length >= PUBLIC_RECORDS_MAX_SUBSIDIARY_NAME_LIST) break;
  }
  return out;
}

export function clampSubsidiaryDomicileList(doms: string[]): string[] {
  const out: string[] = [];
  const maxItem = 120;
  for (const raw of doms) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim();
    const truncated = t.length > maxItem ? `${t.slice(0, maxItem)}…` : t;
    out.push(truncated);
    if (out.length >= PUBLIC_RECORDS_MAX_SUBSIDIARY_NAME_LIST) break;
  }
  return out;
}

/**
 * Returns a Prisma-safe JSON value (plain data only). Truncates rows/cells and byte size when needed.
 */
export function clampExhibit21SnapshotForPersist(raw: unknown): Exhibit21GridSnapshotV1 | null {
  if (raw == null) return null;
  const parsed = parseExhibit21GridSnapshot(raw);
  if (!parsed) {
    try {
      JSON.stringify(raw);
    } catch {
      return null;
    }
    return null;
  }

  const aligned = normalizeExhibit21MisalignedEntityColumn(parsed);

  let rows = aligned.rows.map((r) =>
    r.map((c) =>
      c.length > PUBLIC_RECORDS_MAX_EXHIBIT21_CELL_CHARS
        ? `${c.slice(0, PUBLIC_RECORDS_MAX_EXHIBIT21_CELL_CHARS)}…`
        : c
    )
  );
  if (rows.length > PUBLIC_RECORDS_MAX_EXHIBIT21_ROWS) {
    rows = rows.slice(0, PUBLIC_RECORDS_MAX_EXHIBIT21_ROWS);
  }

  let snap: Exhibit21GridSnapshotV1 = { ...aligned, rows };

  while (utf8JsonBytes(snap) > PUBLIC_RECORDS_MAX_EXHIBIT21_JSON_UTF8_BYTES && snap.rows.length > 3) {
    const delta = Math.max(50, Math.floor(snap.rows.length * 0.08));
    const nextLen = Math.max(snap.hasHeaderRow ? 2 : 3, snap.rows.length - delta);
    rows = rows.slice(0, nextLen);
    snap = { ...aligned, rows };
  }

  return cloneJsonStrict(snap);
}

export function publicRecordsProfileSaveErrorHint(message: string): string {
  const m = message.replace(/\s+/g, " ").trim();
  if (/P2000|P2010|too long|maximum|exceed.*size|payload|entity too large/i.test(m)) {
    return "The saved profile exceeds size limits — subsidiary list or Exhibit 21 grid was trimmed automatically on the next save. If this persists, use Refresh after updating the app.";
  }
  if (/Invalid.*prisma|PrismaClientValidationError|JSON/i.test(m)) {
    return "Could not validate profile data for the database — try Refresh from SEC once, or remove unusual characters from the Exhibit 21 grid and save again.";
  }
  if (/column.*does not exist|Unknown arg|subsidiary_domiciles|subsidiary_exhibit21_snapshot/i.test(m)) {
    return "Database schema may be outdated. Run prisma migrate deploy and restart the server.";
  }
  return "Could not save the public records profile.";
}
