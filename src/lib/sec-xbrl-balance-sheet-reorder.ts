/**
 * Some SEC presentation linkbases (and IDEA viewer fallbacks) list non‑current investment lines or
 * disposal‑group current liabilities at the **end** of the balance sheet. Move those rows next to
 * obvious face anchors so the grid matches how readers expect assets / current liabilities to flow.
 */

type BsRow = {
  concept: string;
  label: string;
  depth: number;
};

function conceptLocalNorm(concept: string): string {
  const i = concept.lastIndexOf(":");
  const name = i >= 0 ? concept.slice(i + 1) : concept;
  return name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isCostMethodOrSimilarLongTermInvestmentRow(row: BsRow): boolean {
  const ln = conceptLocalNorm(row.concept);
  if (/costmethodinvestments?/i.test(ln)) return true;
  const lab = row.label.toLowerCase();
  return /\bcost\s+method\s+invest/i.test(lab);
}

/** Non‑cost long‑term / affiliate investment face lines we place cost‑method next to. */
function isInvestmentAssetPeerBeforeCostMethod(row: BsRow): boolean {
  const ln = conceptLocalNorm(row.concept);
  if (/costmethodinvestments?/i.test(ln)) return false;
  return (
    /marketablesecurities|availableforsalesecurities|availableforsaledebt|heldtomaturity|equitysecurities|debtsecurities|equitymethodinvestments|otherlongterminvestments|otherinvestments|longterminvestments|investmentsinandadvancetoaffiliate|investmentinandadvancetoaffiliate|longterminvestment|shortterminvestment/i.test(
      ln
    ) ||
    /investmentsinandadvance/i.test(ln) ||
    /(investment|securit).*(noncurrent|non.current|longterm|long.term)/i.test(row.label)
  );
}

function isDisposalGroupCurrentLiabilityRow(row: BsRow): boolean {
  const ln = conceptLocalNorm(row.concept);
  if (
    /disposalgroup.*liabilitiescurrent|disposalgroupincludingdiscontinuedoperationliabilitiescurrent|liabilitiesofdisposalgroupincludingdiscontinuedoperationclassifiedasheldforsalecurrent/i.test(
      ln
    )
  ) {
    return true;
  }
  const lab = row.label.toLowerCase().replace(/\s+/g, " ");
  return (
    /disposal\s+group.*liabilit.*current/.test(lab) &&
    /discontinued|disposal/i.test(lab)
  );
}

/** Consolidated “liabilities and equity” / balance‑sheet check line (face total). */
function findConsolidatedBalanceSheetTotalIndex(rows: BsRow[]): number {
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    const ln = conceptLocalNorm(rows[i]!.concept);
    if (
      /^liabilitiesandstockholdersequity$/i.test(ln) ||
      /^liabilitiesandequity$/i.test(ln) ||
      /^liabilitiesandnetassets$/i.test(ln)
    ) {
      last = i;
      continue;
    }
    const lab = rows[i]!.label.toLowerCase().replace(/\s+/g, " ");
    if (/^consolidated\s+liabilities\s+and\s+/i.test(lab)) {
      last = i;
      continue;
    }
    if (/^liabilities\s+and\s+(\(?(stockholders|shareholders)\)?\s+)?equity/i.test(lab)) {
      last = i;
      continue;
    }
    if (/^liabilities\s+&\s+equity$/i.test(lab.trim())) {
      last = i;
      continue;
    }
    if (/^liabilities\s+and\s+equity$/i.test(lab.trim())) {
      last = i;
      continue;
    }
    if (/^total\s+liabilities\s+and\s+/i.test(lab)) {
      last = i;
      continue;
    }
  }
  return last;
}

/** Last “total current liabilities” subtotal before consolidated total (better anchor than first duplicate). */
function findTotalCurrentLiabilitiesSubtotalIndex(rows: BsRow[], capExclusive: number): number {
  const cap = capExclusive < 0 ? rows.length : capExclusive;
  let last = -1;
  for (let i = 0; i < cap && i < rows.length; i++) {
    const ln = conceptLocalNorm(rows[i]!.concept);
    if (ln === "liabilitiescurrent") last = i;
    const lab = rows[i]!.label.toLowerCase();
    if (/^total\s+current\s+liabilit/i.test(lab) || /total\s+current\s+liabilit/.test(lab)) last = i;
  }
  return last;
}

/** First detail line in the current‑liabilities section (face order), for anchors when the subtotal tag is absent. */
function findFirstCurrentLiabilityLineIndex(rows: BsRow[], capExclusive: number): number {
  const cap = capExclusive < 0 ? rows.length : capExclusive;
  for (let j = 0; j < cap && j < rows.length; j++) {
    const ln = conceptLocalNorm(rows[j]!.concept);
    if (
      /accountspayable|accruedliabilities|employeerelatedliab|incometax|taxpayable|deferredrevenue|contractwithcustomer|otherliabilitiescurrent|shorttermborrowings|commercialpaper|currentportionoflongtermdebt|longtermdebtcurrent|notespayable|customerdeposits|dividendspayable/i.test(
        ln
      )
    ) {
      return j;
    }
  }
  return -1;
}

function moveRowToIndex(rows: BsRow[], from: number, to: number): void {
  if (from === to || from < 0 || from >= rows.length || to < 0 || to > rows.length) return;
  const [r] = rows.splice(from, 1);
  const adjTo = from < to ? to - 1 : to;
  rows.splice(adjTo, 0, r);
  const placed = adjTo;
  const prev = rows[Math.max(0, placed - 1)];
  if (prev) r.depth = prev.depth;
}

/**
 * Reorder balance sheet face rows for common presentation glitches. Idempotent for typical inputs.
 */
export function reorderBalanceSheetRowsForPresentationSemantics<T extends BsRow>(rows: T[]): T[] {
  if (rows.length <= 2) return rows;
  const out = [...rows];

  const totalLE = findConsolidatedBalanceSheetTotalIndex(out);

  const costIdxs: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (isCostMethodOrSimilarLongTermInvestmentRow(out[i]!)) costIdxs.push(i);
  }
  for (const i of [...costIdxs].sort((a, b) => b - a)) {
    const afterTotal = totalLE >= 0 && i > totalLE;
    const peerCap = totalLE >= 0 ? totalLE : i;

    let lastPeer = -1;
    for (let j = 0; j < peerCap; j++) {
      if (isInvestmentAssetPeerBeforeCostMethod(out[j]!)) lastPeer = j;
    }
    if (lastPeer >= 0) {
      const target = lastPeer + 1;
      if (target !== i) moveRowToIndex(out, i, target);
      continue;
    }

    let k = -1;
    const tangibleCap = afterTotal && totalLE >= 0 ? totalLE : i;
    for (let j = 0; j < tangibleCap; j++) {
      const ln = conceptLocalNorm(out[j]!.concept);
      // Do not anchor on lease *liabilities* (names still contain "operatinglease" / "rightofuse").
      if (/liabilit|payable/i.test(ln)) continue;
      if (
        /propertyplant|plantandequipment|goodwill|finite|indefinite|intangibleassets|intangibleasset|operatinglease|financelease|rightofuse/i.test(
          ln
        )
      ) {
        k = j;
        break;
      }
    }
    if (k >= 0) {
      moveRowToIndex(out, i, k);
      continue;
    }

    if (afterTotal && totalLE >= 0) {
      let lastAssetLike = -1;
      for (let j = 0; j < totalLE; j++) {
        const ln = conceptLocalNorm(out[j]!.concept);
        const liabish =
          /liabilit|payable|debtnoncurrent|longtermdebt|stockholder|member|partner|retained|treasury|apic|additionalpaid|accumulatedothercomprehensive/i.test(
            ln
          );
        if (liabish) continue;
        if (
          /asset|cash|receivable|inventory|prepaid|security|securit|goodwill|intangible|property|investment|advance|lease.*asset|rightofuseasset/i.test(
            ln
          )
        ) {
          lastAssetLike = j;
        }
      }
      const firstCL = findFirstCurrentLiabilityLineIndex(out, totalLE);
      const target =
        lastAssetLike >= 0 ? lastAssetLike + 1 : firstCL >= 0 ? firstCL : Math.max(0, totalLE - 1);
      if (target !== i) moveRowToIndex(out, i, target);
    }
  }

  const totalLE2 = findConsolidatedBalanceSheetTotalIndex(out);
  const capForCl = totalLE2 >= 0 ? totalLE2 : out.length;
  const dispIdxs: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (isDisposalGroupCurrentLiabilityRow(out[i]!)) dispIdxs.push(i);
  }
  for (const i of [...dispIdxs].sort((a, b) => b - a)) {
    let anchor = findTotalCurrentLiabilitiesSubtotalIndex(out, capForCl);
    if (anchor < 0) anchor = findFirstCurrentLiabilityLineIndex(out, capForCl);
    if (anchor < 0 || i === anchor) continue;
    if (i > anchor) moveRowToIndex(out, i, anchor);
  }

  return out;
}
