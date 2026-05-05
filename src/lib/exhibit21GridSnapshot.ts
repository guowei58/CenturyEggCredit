/**
 * Public Records Exhibit 21: store full grid as scraped from EDGAR (all columns visible in the exhibit).
 */

export type Exhibit21GridSnapshotV1 = {
  v: 1;
  /** When true, first row is table headers only (shown with <thead> styling). */
  hasHeaderRow: boolean;
  /** Rectangular rows; headers included as row [0] when hasHeaderRow. */
  rows: string[][];
  source: "html_table" | "text_lines";
};

export function parseExhibit21GridSnapshot(json: unknown): Exhibit21GridSnapshotV1 | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.hasHeaderRow !== "boolean") return null;
  if (!Array.isArray(o.rows)) return null;
  const rows = o.rows
    .filter((r): r is unknown[] => Array.isArray(r))
    .map((r) => r.filter((c): c is string => typeof c === "string").map((c) => c.replace(/\s+/g, " ").trim()));
  if (rows.length === 0) return null;
  if (!rows.some((r) => r.some((c) => c.length > 0))) return null;
  const src = o.source === "html_table" || o.source === "text_lines" ? o.source : null;
  if (!src) return null;
  return { v: 1, hasHeaderRow: o.hasHeaderRow, rows: rectangularizeRows(rows), source: src };
}

function rectangularizeRows(rows: string[][]): string[][] {
  const w = Math.max(...rows.map((r) => r.length), 0);
  if (w === 0) return rows;
  return rows.map((r) => {
    const out = [...r];
    while (out.length < w) out.push("");
    return out;
  });
}

function rowReadsLikeSubsidiaryHeader(row: string[]): boolean {
  /** Strip "(50%)", "(64.45%)"-style equity notes so "%" isn't treated as a literal header token */
  let j = row.join(" | ").replace(/\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/gi, " ");
  j = j.replace(/\(\s*[0-9]{1,2}\s*%?\s*[–-]\s*[0-9]{1,2}\s*%?\s*\)/gi, " ");
  j = j.toLowerCase();
  return /\bsubsidiary\b|\blegal\b|\bjurisdiction\b|\bincorporat|\bownership\b|\b(?:percent(?:age)?|interest)\b|\bdomicile\b|\bdoing\s+business\b|\bname\s+of\b/.test(j);
}

/** Exported for Exhibit 21 HTML ingestion (continuation tables, header dedupe). */
export function isSubsidiaryScheduleHeaderRow(row: string[]): boolean {
  return rowReadsLikeSubsidiaryHeader(row);
}

export function detectExhibit21HeaderRow(rows: string[][]): { hasHeaderRow: boolean; bodyRows: string[][] } {
  if (rows.length < 2) return { hasHeaderRow: false, bodyRows: rows };
  if (rowReadsLikeSubsidiaryHeader(rows[0]!)) return { hasHeaderRow: true, bodyRows: rows };
  return { hasHeaderRow: false, bodyRows: rows };
}

function resolveSubsidiaryNameColumnIndex(hasHeaderRow: boolean, rows: string[][]): { nameCol: number; body: string[][] } {
  const headerCells = hasHeaderRow ? rows[0] ?? [] : [];
  const body = hasHeaderRow ? rows.slice(1) : rows;
  let nameCol = 0;
  if (headerCells.length) {
    const idx = headerCells.findIndex((h) =>
      /\bsubsidiar(?:y|ies)?\b|\blegal\s+name\b|\bentity\s+name\b|\bcompany\s+name\b/i.test(h.trim())
    );
    if (idx >= 0) nameCol = idx;
  }
  return { nameCol, body };
}

/** Body cell that may hold a legal entity name (used when the inferred subsidiary column is empty). */
export function isPlausibleExhibit21NameCell(cell: string): boolean {
  const t = cell.replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 240) return false;
  if (/^of\s+incorporation/i.test(t)) return false;
  if (/^state\s+or\s+country/i.test(t)) return false;
  if (/^\d{1,4}%?$/.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t)) return false;
  return true;
}

/** True when cell looks like a domicile / jurisdiction token (often column after an entity-name column shifted right). */
export function looksLikeDomCodeOrRegion(cell: string): boolean {
  const t = cell.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (t.length < 2 || t.length > 40) return false;
  /** Two-letter filings (Delaware DE, Nevada NV, Cayman KY false positive — Exhibit 21 table context). */
  if (t.length === 2 && /^[A-Z]{2}$/i.test(t)) return true;
  if (
    /^(DELAWARE|DEL|NEVADA|CALIFORNIA|NEW YORK|NEW\s+YORK|TEXAS|FLORIDA|ILLINOIS|OHIO|PENNSYLVANIA|GEORGIA|WASHINGTON|MARYLAND|VIRGINIA|TENNESSEE|MINNESOTA|COLORADO|MASSACHUSETTS|MICHIGAN|WISCONSIN|CONNECTICUT|MISSOURI|LOUISIANA|ALASKA|SOUTH\s+CAROLINA|NEW\s+JERSEY|ARIZONA|OREGON|UTAH)\b/i.test(
      t
    )
  )
    return true;
  return false;
}

/**
 * Finds header cell index matching `predicate`, skipping columns that clearly are not semantic headers (generic "column N").
 */
function resolveHeaderCellIndex(headers: string[], predicate: (h: string) => boolean): number {
  let best = headers.findIndex((h) => {
    const z = h.trim();
    return z.length > 0 && !/^column\s*\d+/i.test(z) && predicate(z);
  });
  if (best >= 0) return best;

  /** Header row may be blank / generic placeholders — infer by predicate on any matching cell anyway. */
  best = headers.findIndex((h) => predicate(h.trim()));
  return best;
}

/** When entity column is blank but adjacent “domicile” column carried legal names & next column jurisdictions, slide left once. */
function normalizeMisalignedSubsidiaryRowForPersist(
  row: string[],
  entityIdx: number,
  guessedDomIdx: number
): string[] | null {
  const e = row[entityIdx]?.trim() ?? "";
  if (e.length > 0) return null;

  const domGuess = guessedDomIdx >= 0 ? (row[guessedDomIdx]?.trim() ?? "") : "";
  const jurGuess = guessedDomIdx + 1 < row.length ? row[guessedDomIdx + 1]!.trim() : "";

  if (!isPlausibleExhibit21NameCell(domGuess)) return null;
  if (!looksLikeDomCodeOrRegion(jurGuess)) return null;

  const w = row.length;
  const out = row.slice();

  /** Entity ← former dom guess; jurisdiction column ← jur; remaining cells shift left toward `guessedDomIdx + 2`. */
  out[entityIdx] = domGuess;
  out[guessedDomIdx] = jurGuess;
  let write = guessedDomIdx + 1;
  for (let j = guessedDomIdx + 2; j < w && write < w; j++) {
    out[write++] = typeof row[j] === "string" ? row[j]!.replace(/\s+/g, " ").trim() : "";
  }
  while (write < w) out[write++] = "";

  return out;
}

/**
 * Persist-time fix: scraped or pasted Exhibit 21 where column 1 (Entity Name) is empty while names sit under “Domicile”
 * and two-letter/state codes drift one column further right.
 */
export function normalizeExhibit21MisalignedEntityColumn(s: Exhibit21GridSnapshotV1): Exhibit21GridSnapshotV1 {
  if (!s.hasHeaderRow || s.rows.length < 2) return s;

  const headers = (s.rows[0] ?? []).map((x) => (typeof x === "string" ? x : ""));
  let entityIdx = resolveHeaderCellIndex(headers, (h) =>
    /\bsubsidiar(?:y|ies)?\b|\blegal\s+name\b|\bentity\s+name\b|\bcompany\s+name\b/i.test(h.trim())
  );
  if (entityIdx < 0) entityIdx = 0;

  let guessedDomIdx = resolveHeaderCellIndex(headers, (h) =>
    /\bdomicile\b|\bjurisdiction\b|\b(?:state|country)\s+(?:of\s+)?(?:incorporat|\w+)/i.test(h.trim())
  );
  if (
    guessedDomIdx < 0 &&
    headers.length >= entityIdx + 2 &&
    entityIdx >= 0 &&
    !/\b(?:name|subsidiary|entity|company|legal)/i.test((headers[entityIdx + 1] ?? "").trim())
  ) {
    guessedDomIdx = entityIdx + 1;
  }
  if (guessedDomIdx < 0) return s;

  const newRows = s.rows.map((row, ri) => {
    if (ri === 0) return row.slice();
    const fixed = normalizeMisalignedSubsidiaryRowForPersist(row, entityIdx, guessedDomIdx);
    return fixed ?? row.slice();
  });

  return { ...s, rows: rectangularizeRows(newRows) };
}

/**
 * Prefer the inferred entity column when it carries a plausible name; otherwise scan other columns left-to-right
 * (fixes layouts where subsidiaries sit under “Entity Name” for row 1 but subsequent rows omit column 1 and put names under “Domicile”).
 */
export function pickSubsidiaryNameFromGridBodyRow(row: string[], nameCol: number): string | null {
  if (row.length === 0) return null;

  const idxs = Array.from({ length: row.length }, (_, i) => i);
  const colOrder =
    nameCol >= 0 && nameCol < row.length
      ? [nameCol, ...idxs.filter((i) => i !== nameCol)]
      : [...idxs];

  for (const ci of colOrder) {
    const cell = (row[ci] ?? "").trim();
    if (!isPlausibleExhibit21NameCell(cell)) continue;
    /** Skip lone jurisdiction tokens mistakenly caught as “names”. */
    if (looksLikeDomCodeOrRegion(cell) && cell.length <= 14 && !/[,.]/.test(cell) && !/\b(Inc|LLC|Corp|Ltd)\b/i.test(cell))
      continue;
    if (/^of\s+incorporation/i.test(cell)) continue;
    if (/^state\s+or\s+country/i.test(cell)) continue;
    return cell;
  }
  return null;
}

/**
 * One row per grid body row: legal name + jurisdiction when the Exhibit 21 grid exposes those columns.
 */
export function deriveSubsidiaryTableRowsFromGrid(s: Exhibit21GridSnapshotV1): { name: string; jurisdiction: string }[] {
  const sn = normalizeExhibit21MisalignedEntityColumn(s);
  if (sn.rows.length === 0) return [];
  const headers = sn.hasHeaderRow ? ((sn.rows[0] ?? []) as string[]) : [];
  const { nameCol, body } = resolveSubsidiaryNameColumnIndex(sn.hasHeaderRow, sn.rows);

  let jurCol = -1;
  if (headers.length > 0) {
    jurCol = headers.findIndex((h) =>
      /\bdomicile\b|\bjurisdiction\b|\b(?:state|country)\s+(?:of\s+)?(?:incorporat|\w+)/i.test(h.trim())
    );
    if (
      jurCol < 0 &&
      nameCol >= 0 &&
      nameCol + 1 < headers.length &&
      !/\b(?:name|subsidiary|entity|company|legal)\b/i.test((headers[nameCol + 1] ?? "").trim())
    ) {
      jurCol = nameCol + 1;
    }
  }

  const out: { name: string; jurisdiction: string }[] = [];
  const seen = new Set<string>();
  const safeNameCol = nameCol >= 0 ? nameCol : 0;

  for (const row of body) {
    const picked = pickSubsidiaryNameFromGridBodyRow(row, safeNameCol < row.length ? safeNameCol : 0);
    if (!picked) continue;
    const k = picked.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);

    let jurisdiction = "";
    if (jurCol >= 0 && jurCol < row.length) jurisdiction = (row[jurCol] ?? "").replace(/\s+/g, " ").trim();
    if (!jurisdiction) {
      for (let i = 0; i < row.length; i++) {
        if (i === safeNameCol) continue;
        const c = (row[i] ?? "").replace(/\s+/g, " ").trim();
        if (c === picked.trim()) continue;
        if (looksLikeDomCodeOrRegion(c)) {
          jurisdiction = c;
          break;
        }
      }
    }

    out.push({ name: picked.replace(/\s+/g, " ").trim(), jurisdiction });
  }

  return out;
}

/** Search-term hints — one name per grid body row whenever possible (not only rows with data in entity column). */
export function deriveSubsidiarySearchNamesFromGrid(s: Exhibit21GridSnapshotV1, maxNames = 12_000): string[] {
  if (s.rows.length === 0) return [];
  const { nameCol, body } = resolveSubsidiaryNameColumnIndex(s.hasHeaderRow, s.rows);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of body) {
    const picked = pickSubsidiaryNameFromGridBodyRow(row, nameCol < row.length ? nameCol : 0);
    if (!picked) continue;
    const k = picked.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(picked);
    if (out.length >= maxNames) break;
  }
  return out;
}

/**
 * Alias for Exhibit 21 display / search chips — identical to deriveSubsidiarySearchNamesFromGrid once per-row shifting is solved.
 */
export function deriveSubsidiaryDisplayNamesFromGrid(s: Exhibit21GridSnapshotV1, maxNames = 12_000): string[] {
  return deriveSubsidiarySearchNamesFromGrid(s, maxNames);
}
