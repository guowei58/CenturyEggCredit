/**
 * Extract full subsidiary schedule grid from Exhibit 21 HTML (or plain text) for Public Records snapshot.
 * - Uses the full SEC document (no truncation) so later pages in the same .htm are included.
 * - Merges same-width continuation <table>s (common in paginated XBRL / Workiva).
 * - Explodes prose megacells like "Foo LLC (DE) Bar Ltd (UK)" into one row per subsidiary.
 */

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import {
  detectExhibit21HeaderRow,
  isSubsidiaryScheduleHeaderRow,
  type Exhibit21GridSnapshotV1,
} from "@/lib/exhibit21GridSnapshot";

function decodeInlineHtmlEntities(s: string): string {
  let t = s.replace(/&#x([0-9a-fA-F]{1,6});?/gi, (_, h: string) => {
    const cp = parseInt(h, 16);
    try {
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
    } catch {
      return _;
    }
  });
  t = t.replace(/&#(\d{2,7});?/g, (_, n: string) => {
    const code = parseInt(n, 10);
    try {
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    } catch {
      return _;
    }
  });
  return t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}

function normalizeCellText(cell: string): string {
  return decodeInlineHtmlEntities(cell).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function matrixWidth(mx: string[][]): number {
  return Math.max(0, ...mx.map((r) => r.length));
}

function rectangularize(mx: string[][], width: number): string[][] {
  return mx.map((r) => {
    const out = [...r];
    while (out.length < width) out.push("");
    return out;
  });
}

function scrapeSingleTableIntoMatrix($: cheerio.CheerioAPI, table: Element): string[][] | null {
  const rows: string[][] = [];
  $(table)
    .find("tr")
    .each((__, tr) => {
      const cells: string[] = [];
      $(tr)
        .find("th,td")
        .each((___, td) => {
          cells.push(normalizeCellText($(td).text()));
        });
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    });
  if (rows.length < 2) return null;
  const w = matrixWidth(rows);
  if (w < 1) return null;
  return rectangularize(rows, w);
}

function tableBlobLower(mx: string[][]): string {
  return mx.map((r) => r.join(" ")).join("\n").toLowerCase();
}

function subsidiaryTableBoostScore(mx: string[][]): number {
  const flatBlob = tableBlobLower(mx);
  let bump = 0;
  if (/\blist\s+of\s+subsidiaries\b/.test(flatBlob)) bump += 400;
  const parenCount = flatBlob.match(/\(/g)?.length ?? 0;
  if (parenCount >= 2) bump += Math.min(parenCount * 14, 320);
  const ownershipPctChunks = flatBlob.match(/\(\s*\d{1,3}(?:\.\d+)?\s*%\)/g)?.length ?? 0;
  if (ownershipPctChunks >= 2) bump += Math.min(ownershipPctChunks * 22, 220);
  if (/\b(llc|l\.l\.c\.|inc\.?|corp\.?|limited|ltd\.?|plc|gmbh|s\.a\.|n\.v\.|\boy\b|\baps\b|\bs\.?\s*r\.?\s*l\.?\b)\b/i.test(flatBlob)) bump += 120;
  /** Penalise tiny filename / index fragments that sometimes appear as a one-row table. */
  const oneLine = mx.map((r) => r.join("")).join("").replace(/\s+/g, "");
  if (oneLine.length < 180 && /\.htm(l)?$/i.test(oneLine)) bump -= 900;
  return bump;
}

function scoreMatrixCandidate(mx: string[][]): number {
  const w = matrixWidth(mx);
  const rows = mx.length;
  let nonEmpty = 0;
  for (const r of mx) for (const c of r) if (c.trim().length > 1) nonEmpty++;
  return rows * Math.max(w, 1) * 8 + nonEmpty + subsidiaryTableBoostScore(mx);
}

function mergeSameWidthTablesDomOrder(matrices: string[][][]): string[][] | null {
  const byW = new Map<number, string[][][]>();
  for (const mx of matrices) {
    const w = matrixWidth(mx);
    if (w < 2) continue;
    const list = byW.get(w) ?? [];
    list.push(mx);
    byW.set(w, list);
  }
  let best: string[][] | null = null;
  let bestScore = -1;
  for (const [, mats] of byW) {
    if (mats.length < 2) continue;
    let out = rectangularize([...mats[0]!], matrixWidth(mats[0]!));
    for (let i = 1; i < mats.length; i++) {
      let nxt = rectangularize([...mats[i]!], matrixWidth(mats[i]!));
      if (nxt.length > 0 && isSubsidiaryScheduleHeaderRow(nxt[0]!)) nxt = nxt.slice(1);
      out = [...out, ...nxt];
    }
    const w = matrixWidth(out);
    out = rectangularize(out.filter((r) => r.some((c) => c.trim())), w);
    if (out.length < 2) continue;
    const sc = scoreMatrixCandidate(out);
    if (sc > bestScore) {
      bestScore = sc;
      best = out;
    }
  }
  return best;
}

const MAX_MERGE_COL_WIDTH_DELTA = 2;

/**
 * Chains consecutive <table> matrices in DOM order when column counts differ slightly
 * (`<hr/>` page breaks sometimes switch markup so one side has trailing empty `<td>`s).
 * Avoids dropping a smaller continuation table because `bestSingle` picked only the taller fragment.
 */
function mergeRelaxWidthContinuationDomOrder(matrices: string[][][]): string[][] | null {
  const usable = matrices.filter((mx) => matrixWidth(mx) >= 2 && mx.length >= 2);
  if (usable.length < 2) return null;

  function chainFrom(startIdx: number): string[][] | null {
    let acc = rectangularize([...usable[startIdx]!], matrixWidth(usable[startIdx]!));
    for (let i = startIdx + 1; i < usable.length; i++) {
      const nxtSrc = usable[i]!;
      const wa = matrixWidth(acc);
      const wb = matrixWidth(nxtSrc);
      if (Math.abs(wa - wb) > MAX_MERGE_COL_WIDTH_DELTA) break;
      if (subsidiaryTableBoostScore(nxtSrc) < -700) break;

      let nxtRows = rectangularize([...nxtSrc], wb);
      if (nxtRows.length > 0 && isSubsidiaryScheduleHeaderRow(nxtRows[0]!)) nxtRows = nxtRows.slice(1);
      if (!nxtRows.some((r) => r.some((c) => c.trim()))) break;

      const wTarget = Math.max(wa, wb);
      acc = [...rectangularize(acc, wTarget), ...rectangularize(nxtRows, wTarget)];
      acc = rectangularize(acc.filter((r) => r.some((c) => c.trim())), matrixWidth(acc));
    }
    return acc.length >= 2 ? acc : null;
  }

  let best: string[][] | null = null;
  let bestScore = -1;
  for (let s = 0; s < usable.length; s++) {
    if (subsidiaryTableBoostScore(usable[s]!) < -800) continue;
    const ch = chainFrom(s);
    if (!ch) continue;
    const sc = scoreMatrixCandidate(ch);
    if (sc > bestScore) {
      bestScore = sc;
      best = ch;
    }
  }
  return best;
}

function stripPreambleGarbageRows(mx: string[][]): string[][] {
  return mx.filter((r) => {
    const blob = r.join(" ").trim();
    if (!blob) return false;
    const compact = blob.replace(/\s+/g, "");
    if (/^meta-[a-z0-9_-]+\.(?:htm|html|txt)$/i.test(compact.slice(0, 200))) return false;
    if (/^[a-z0-9_-]+\d+x\d+k.*\.htm(?:\.\d+)?$/i.test(compact.slice(0, 220))) return false;
    if (blob.length <= 70 && /\bEXHIBIT\s+[\d.]+\s*$/i.test(blob)) return false;
    if (blob.length <= 240 && /\bLIST\s+OF\s+SUBSIDIARIES\b/i.test(blob) && !/\(/.test(blob)) return false;
    return true;
  });
}

/** "Foo Holdings, LLC (Delaware) Bar Ltd (United Kingdom)" → one subsidiary per row. */
function splitParentheticalSubsidiaryRun(text: string): string[][] | null {
  const t = normalizeCellText(text);
  if (t.length < 40 || (t.match(/\(/g)?.length ?? 0) < 2) return null;
  const pairs: string[][] = [];
  let rest = t;
  while (rest.length >= 10) {
    const openIdx = rest.indexOf("(");
    if (openIdx < 2) break;
    const closeIdx = rest.indexOf(")", openIdx + 1);
    if (closeIdx <= openIdx + 1) break;
    const jur = rest.slice(openIdx + 1, closeIdx).trim();
    const namePart = rest.slice(0, openIdx).trim();
    if (!/^[A-Za-z0-9]/.test(namePart)) break;
    if (jur.length < 2 || jur.length > 120) break;
    if (/^\d{1,3}\)?$/.test(jur)) {
      rest = rest.slice(closeIdx + 1).trim();
      continue;
    }
    pairs.push([namePart, jur]);
    rest = rest.slice(closeIdx + 1).trim();
  }
  return pairs.length >= 2 ? pairs : null;
}

function explodeMegacellsToGrid(rowsIn: string[][]): string[][] {
  const out: string[][] = [];
  let producedTwoColProse = false;

  for (const r of rowsIn) {
    if (r.length === 1) {
      const exploded = splitParentheticalSubsidiaryRun(r[0]!);
      if (exploded) {
        for (const pr of exploded) out.push(pr);
        producedTwoColProse = true;
        continue;
      }
    }
    /** One cell contains the whole list; other columns are empty or footnote — still split col0. */
    if (r.length >= 2) {
      const c0 = r[0] ?? "";
      if (c0.length > 200) {
        const exploded = splitParentheticalSubsidiaryRun(c0);
        if (exploded) {
          const restCells = r.slice(1);
          for (const pr of exploded) {
            out.push([...pr, ...restCells]);
          }
          producedTwoColProse = true;
          continue;
        }
      }
    }
    out.push([...r]);
  }

  if (out.length < 2) return rowsIn;
  const w = matrixWidth(out);
  const rect = rectangularize(out, w);
  if (
    producedTwoColProse &&
    w >= 2 &&
    !rect.some((row) => isSubsidiaryScheduleHeaderRow(row))
  ) {
    return [["Subsidiary", "Incorporation or organization", ...Array.from({ length: Math.max(0, w - 2) }, () => "")], ...rect];
  }
  return rect;
}

function exhibit21LinesFromRoughHtml(html: string): string[] {
  const withBreaks = html
    .replace(/<hr\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/table>/gi, "\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<[^>]+>/g, " ");
  const flat = withBreaks
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return flat
    .split(/\n+/)
    .map((l) => {
      let t = l.trim().replace(/\t+/g, " | ").replace(/\s*\|\s*/g, " | ").replace(/\s+/g, " ").trim();
      t = normalizeCellText(t);
      return t.startsWith("|") ? t.slice(1).trim() : t;
    })
    .filter((l) => l.length >= 4);
}

function rowsFromTabOrPipeLines(lines: string[]): string[][] {
  const rowsOut: string[][] = [];
  for (const line of lines) {
    let parts: string[];
    if (line.includes("|")) parts = line.split(/\s*\|\s*/).map((p) => p.trim());
    else if (line.includes("\t")) parts = line.split(/\t+/).map((p) => p.trim());
    else parts = [line];
    rowsOut.push(parts);
  }
  return rowsOut;
}

export function extractExhibit21GridSnapshotFromDocument(rawIn: string): Exhibit21GridSnapshotV1 | null {
  const raw = decodeInlineHtmlEntities(rawIn).replace(/\u00feff/g, "");
  if (!raw || raw.length < 80) return null;
  const looksHtml = /<\s*html\b/i.test(raw.slice(0, 5000)) || /<\s*table\b/i.test(raw);

  let rows: string[][] | null = null;
  let source: Exhibit21GridSnapshotV1["source"] = "text_lines";

  if (looksHtml) {
    const $ = cheerio.load(raw);
    const matrices: string[][][] = [];
    $("table").each((_, tbl) => {
      const mx = scrapeSingleTableIntoMatrix($, tbl as Element);
      if (mx) matrices.push(mx);
    });

    let bestSingle: string[][] | null = null;
    let bestScore = -1;
    for (const mx of matrices) {
      const sc = scoreMatrixCandidate(mx);
      if (sc > bestScore) {
        bestScore = sc;
        bestSingle = mx;
      }
    }

    const mergedSameWidth = mergeSameWidthTablesDomOrder(matrices);
    const mergedRelaxWidths = mergeRelaxWidthContinuationDomOrder(matrices);

    let chosen = bestSingle;
    let chosenSc = bestScore;

    function consider(candidate: string[][] | null) {
      if (!candidate || candidate.length < 2) return;
      const sc = scoreMatrixCandidate(candidate);
      if (sc >= chosenSc) {
        chosen = candidate;
        chosenSc = sc;
      }
    }

    consider(mergedSameWidth);
    consider(mergedRelaxWidths);

    if (chosen && chosen.length >= 2) {
      rows = stripPreambleGarbageRows(chosen).filter((r) => r.some((c) => c.trim()));
      if (rows.length < 2 && bestSingle) {
        rows = stripPreambleGarbageRows(bestSingle).filter((r) => r.some((c) => c.trim()));
      }
      source = "html_table";
    }

    if (!rows || rows.length < 2) {
      const lined = exhibit21LinesFromRoughHtml(raw);
      const filtered = lined.filter(
        (l) => l.length >= 12 && !/^\*{0,2}\s*(exhibit|schedule)\s*21\b/i.test(l.trim())
      );
      const rr = rowsFromTabOrPipeLines(filtered);
      if (rr.length >= 2) {
        rows = rr;
        source = "text_lines";
      }
    }
  } else {
    const lined = raw.split(/\r?\n/).map((l) => normalizeCellText(l)).filter(Boolean);
    const rr = rowsFromTabOrPipeLines(lined);
    if (rr.length >= 2) rows = rr;
  }

  if (!rows || rows.length < 2) return null;

  const width = matrixWidth(rows);
  let rect = rectangularize(rows, width);
  rect = stripPreambleGarbageRows(rect).filter((r) => r.some((c) => c.trim()));
  rect = rectangularize(rect, matrixWidth(rect));
  rect = explodeMegacellsToGrid(rect);
  rect = rectangularize(rect, matrixWidth(rect));
  if (rect.length < 2) return null;

  const detected = detectExhibit21HeaderRow(rect);
  return { v: 1, hasHeaderRow: detected.hasHeaderRow, rows: rect, source };
}
