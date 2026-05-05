import { splitSubsidiaryLine } from "@/lib/exhibit21SubsidiaryRows";
import {
  deriveSubsidiaryDisplayNamesFromGrid,
  deriveSubsidiarySearchNamesFromGrid,
  deriveSubsidiaryTableRowsFromGrid,
  isPlausibleExhibit21NameCell,
  looksLikeDomCodeOrRegion,
  normalizeExhibit21MisalignedEntityColumn,
  parseExhibit21GridSnapshot,
} from "@/lib/exhibit21GridSnapshot";
import { normalizeEntityName } from "@/lib/entityNormalize";

/**
 * Mirrors the subsidiary name/domicile table on the State & Local Public Records profile editor.
 */
export function subsidiaryRowsFromProfileArrays(
  subsidiaryNames: string[] | undefined,
  subsidiaryDomiciles: string[] | undefined
): { name: string; domicile: string }[] {
  const names = subsidiaryNames ?? [];
  const doms = subsidiaryDomiciles ?? [];
  const len = Math.max(names.length, doms.length);
  const rows: { name: string; domicile: string }[] = [];
  for (let i = 0; i < len; i++) {
    const rawName = names[i] ?? "";
    const rawDom = doms[i] ?? "";
    const p = splitSubsidiaryLine(rawName);
    rows.push({
      name: (p.name || rawName).trim(),
      domicile: (rawDom || p.domicile).trim(),
    });
  }
  if (rows.length === 0) return [{ name: "", domicile: "" }];
  return rows;
}

/** Decode entities often seen when HTML landed in Exhibit 21 or paste fields. */
export function decodeBasicHtmlEntities(s: string): string {
  let t = s.replace(/\u00a0/g, " ");
  const named: Record<string, string> = {
    "&nbsp;": " ",
    "&ldquo;": "\u201c",
    "&rdquo;": "\u201d",
    "&lsquo;": "\u2018",
    "&rsquo;": "\u2019",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
  };
  for (const [entity, rep] of Object.entries(named)) {
    if (t.includes(entity)) t = t.split(entity).join(rep);
  }
  t = t.replace(/&#x([0-9a-f]{1,6});?/gi, (full, h: string) => {
    const cp = Number.parseInt(h, 16);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10_ff_ff) return full;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return full;
    }
  });
  t = t.replace(/&#(\d{1,6});?/g, (full, d: string) => {
    const cp = Number.parseInt(d, 10);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10_ff_ff) return full;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return full;
    }
  });
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Drops obvious definitional clauses / contact blobs / HTML garbage that sometimes lands in pasted schedules.
 */
export function passesSubsidiaryNameSanityChecks(nameRaw: string): boolean {
  const name = decodeBasicHtmlEntities(nameRaw);
  const t = name.replace(/\u201c|\u201d|\u2018|\u2019|"/g, "").trim();
  if (t.length < 3 || t.length > 200) return false;
  const low = t.toLowerCase();
  if (/^[\[\](){}|]+$/.test(t)) return false;
  /** Contract definitions: `"Term" means the …` — not Exhibit 21 names. */
  if (/\smeans\s+(?:the|an?)\s+/i.test(t)) return false;
  if (/\band\s+means\s+(?:the|an?)\s+/i.test(low)) return false;
  if (/\bincluding\s+/i.test(t) && t.length > 100) return false;
  if (/\battached\s+hereto\b/i.test(low)) return false;
  if (/\bsecurity\s+interest\b/i.test(low) && /\benforceable\b/i.test(low)) return false;
  if (/\battn\b|mailto:|@[a-z0-9.-]+\.[a-z]{2,}/i.test(low)) return false;
  if (/\bfl\s*\d{5}\b|\btx\s*\d{5}\b|[A-Z]{2}\s+\d{5}(-\d{4})?\b/i.test(t) && t.length > 50) return false;
  if (/\$\s*[\d,]+(?:\.\d{2})?\s*(million|billion|mm\b|bn\b)?/i.test(t) && /\b(and|or|ltm|consolidated)\b/i.test(low))
    return false;
  if (/^[^\w]*(?:of|to|by|is|has|were|been|than|upon)\s+/i.test(t)) return false;
  if (/^[^\w\(]*\(/.test(t) && /\)\s*[a-z]{4,}\s+[a-z]{4,}/i.test(t) && !/\b(LLC|Inc|Corp|Ltd|PLC|NV|BV|LP)\b/i.test(t))
    return false;
  if (/<[^>]{1,120}>/.test(t)) return false;

  /** Require some letter-like company token (not purely punctuation / numbering). */
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t)) return false;
  return true;
}

/** Display names matching the subsidiary table rows (no legalNames / no parent company lump-in). */
export function subsidiaryChipNamesFromProfile(
  subsidiaryNames: string[] | undefined,
  subsidiaryDomiciles: string[] | undefined
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of subsidiaryRowsFromProfileArrays(subsidiaryNames, subsidiaryDomiciles)) {
    const raw = row.name.replace(/\s+/g, " ").trim();
    if (!raw || raw.length < 2) continue;
    if (!passesSubsidiaryNameSanityChecks(raw)) continue;
    const decoded = decodeBasicHtmlEntities(raw);
    const k = decoded.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(decoded);
  }
  return out;
}

/** What the profile editor shows in the Exhibit 21 grid / subsidiary table — only drop empty/non-textual placeholders. */
function subsidiaryNamePassesTableMirrorChecks(nameRaw: string): boolean {
  const decoded = decodeBasicHtmlEntities(nameRaw.replace(/\s+/g, " ").trim());
  if (decoded.length < 2 || decoded.length > 400) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(decoded)) return false;
  return true;
}

/**
 * Same sources as State & Local Public Records profile: Exhibit 21 grid snapshot when usable,
 * otherwise subsidiary name/domicile rows from the editor.
 */
export function subsidiaryTableRowsFromSavedProfile(
  subsidiaryExhibit21Snapshot: unknown,
  subsidiaryNames?: string[],
  subsidiaryDomiciles?: string[]
): { name: string; domicile: string }[] {
  const parsed = parseExhibit21GridSnapshot(subsidiaryExhibit21Snapshot);
  const grid = parsed ? normalizeExhibit21MisalignedEntityColumn(parsed) : null;
  const bodyRows = grid?.rows?.length ? (grid.hasHeaderRow ? grid.rows.slice(1) : grid.rows) : [];
  const gridHasSubsidiaries = bodyRows.some((row) => row.some((c) => c.trim().length > 0));

  if (grid && gridHasSubsidiaries) {
    const aligned = normalizeExhibit21MisalignedEntityColumn(grid);
    /** Same name ordering / extraction as persisted `subsidiaryNames` on the profile when a grid exists. */
    const searchNames = deriveSubsidiarySearchNamesFromGrid(aligned);
    const tableWithJur = deriveSubsidiaryTableRowsFromGrid(aligned);

    const jurByNorm = new Map<string, string>();
    for (const r of tableWithJur) {
      const nm = decodeBasicHtmlEntities(r.name.replace(/\s+/g, " ").trim());
      if (!nm) continue;
      jurByNorm.set(
        normalizeEntityName(nm).normalized,
        decodeBasicHtmlEntities(r.jurisdiction.replace(/\s+/g, " ").trim())
      );
    }

    const seen = new Set<string>();
    const out: { name: string; domicile: string }[] = [];
    for (const rawName of searchNames) {
      const raw = rawName.replace(/\s+/g, " ").trim();
      if (!subsidiaryNamePassesTableMirrorChecks(raw)) continue;
      const decoded = decodeBasicHtmlEntities(raw);
      const k = decoded.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const dom = jurByNorm.get(normalizeEntityName(decoded).normalized) ?? "";
      out.push({ name: decoded, domicile: dom });
    }

    if (out.length === 0) {
      for (const r of tableWithJur) {
        const raw = r.name.replace(/\s+/g, " ").trim();
        if (!subsidiaryNamePassesTableMirrorChecks(raw)) continue;
        const decoded = decodeBasicHtmlEntities(raw);
        const kk = decoded.toLowerCase();
        if (seen.has(kk)) continue;
        seen.add(kk);
        out.push({
          name: decoded,
          domicile: decodeBasicHtmlEntities(r.jurisdiction.replace(/\s+/g, " ").trim()),
        });
      }
    }

    if (out.length === 0) {
      const body = aligned.hasHeaderRow ? aligned.rows.slice(1) : aligned.rows;
      for (const row of body) {
        let picked: string | null = null;
        for (const cell of row) {
          const t = (cell ?? "").replace(/\s+/g, " ").trim();
          if (!isPlausibleExhibit21NameCell(t)) continue;
          if (
            looksLikeDomCodeOrRegion(t) &&
            t.length <= 14 &&
            !/[,.]/.test(t) &&
            !/\b(Inc|LLC|Corp|Ltd)\b/i.test(t)
          )
            continue;
          if (/^of\s+incorporation/i.test(t)) continue;
          if (/^state\s+or\s+country/i.test(t)) continue;
          picked = decodeBasicHtmlEntities(t);
          break;
        }
        if (!picked || !subsidiaryNamePassesTableMirrorChecks(picked)) continue;
        const k = picked.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        /** One plausible name cell per exhibit row when column inference yielded nothing (matches visible grid intent). */
        out.push({ name: picked.replace(/\s+/g, " ").trim(), domicile: "" });
      }
    }

    if (out.length > 0) return out;
  }

  return subsidiaryRowsFromProfileArrays(subsidiaryNames, subsidiaryDomiciles)
    .map((row) => ({
      name: decodeBasicHtmlEntities(row.name.replace(/\s+/g, " ").trim()),
      domicile: decodeBasicHtmlEntities(row.domicile.replace(/\s+/g, " ").trim()),
    }))
    .filter((row) => subsidiaryNamePassesTableMirrorChecks(row.name));
}

/**
 * Same sources as State & Local Public Records profile: Exhibit 21 grid when present & non-empty
 * (what the UI shows instead of the name/domicile table), otherwise subsidiary name/domicile rows.
 */
export function subsidiaryChipNamesFromSavedProfile(snapshot: unknown, subsidiaryNames?: string[], subsidiaryDomiciles?: string[]): string[] {
  const grid = parseExhibit21GridSnapshot(snapshot);
  const bodyRows = grid?.rows?.length ? (grid.hasHeaderRow ? grid.rows.slice(1) : grid.rows) : [];
  const gridHasSubsidiaries = bodyRows.some((row) => row.some((c) => c.trim().length > 0));

  if (grid && gridHasSubsidiaries) {
    const seen = new Set<string>();
    const gridOut: string[] = [];
    for (const raw of deriveSubsidiaryDisplayNamesFromGrid(grid)) {
      if (!passesSubsidiaryNameSanityChecks(raw)) continue;
      const decoded = decodeBasicHtmlEntities(raw);
      const k = decoded.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      gridOut.push(decoded);
    }
    if (gridOut.length > 0) return gridOut;
  }

  return subsidiaryChipNamesFromProfile(subsidiaryNames, subsidiaryDomiciles);
}
