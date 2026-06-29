import * as XLSX from "xlsx";

export type ParsedCapitalStructureSecurity = {
  name: string;
  cusip: string | null;
  isin: string | null;
  instrumentType: string | null;
  lienLevel: string | null;
  structuralRanking: string | null;
  issuer: string | null;
  coupon: string | null;
  price: string | null;
  yieldToMaturity: string | null;
  faceAmount: string | null;
  currency: string | null;
  maturityDate: string | null;
  maturityLabel: string | null;
  sourceRowIndex: number;
};

type ColumnKey =
  | "name"
  | "cusip"
  | "isin"
  | "instrumentType"
  | "lienLevel"
  | "structuralRanking"
  | "issuer"
  | "coupon"
  | "price"
  | "yieldToMaturity"
  | "faceAmount"
  | "currency"
  | "maturity";

const COLUMN_ALIASES: Record<ColumnKey, RegExp[]> = {
  name: [
    /^instrument(\s*name)?$/i,
    /^security$/i,
    /^facility$/i,
    /^description$/i,
    /^debt\s*instrument$/i,
    /^tranche$/i,
    /^name$/i,
  ],
  cusip: [/^cusip$/i, /^cusip\s*\/\s*isin$/i],
  isin: [/^isin$/i],
  instrumentType: [
    /^instrument\s*type$/i,
    /^type$/i,
    /^facility\s*type$/i,
    /^debt\s*type$/i,
    /^category$/i,
  ],
  lienLevel: [
    /^lien(\s*rank(ing)?)?$/i,
    /^lien\s*level$/i,
    /^seniority$/i,
    /^secured\s*status$/i,
    /^security\s*\/\s*collateral$/i,
    /^ranking$/i,
  ],
  structuralRanking: [/^structural\s*rank(ing)?$/i, /^priority$/i],
  issuer: [/^issuer$/i, /^borrower$/i, /^obligor$/i],
  coupon: [/^coupon$/i, /^spread$/i, /^coupon\s*\/\s*spread$/i, /^rate$/i, /^interest\s*rate$/i],
  price: [/^price$/i, /^market\s*price$/i, /^trading\s*price$/i, /^bid$/i],
  yieldToMaturity: [
    /^ytm$/i,
    /^ytw$/i,
    /^yield$/i,
    /^yield\s*to\s*maturity$/i,
    /^yield\s*to\s*worst$/i,
    /^all[\s-]*in\s*yield$/i,
  ],
  faceAmount: [
    /^face(\s*amount)?$/i,
    /^amount$/i,
    /^outstanding$/i,
    /^drawn$/i,
    /^principal$/i,
    /^current\s*face$/i,
    /^balance$/i,
    /^par$/i,
  ],
  currency: [/^currency$/i, /^ccy$/i],
  maturity: [/^maturity(\s*date)?$/i, /^stated\s*maturity$/i, /^final\s*maturity$/i],
};

const SUMMARY_ROW_PATTERN =
  /^(total|subtotal|gross\s*debt|net\s*debt|cash\b|ebitda|leverage|first\s*lien\s*debt|second\s*lien|secured\s*debt|unsecured\s*debt|preferred|equity|summary|—|--|-)$/i;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeSheetName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findCapitalStructureSheetName(sheetNames: string[]): string | null {
  const scored = sheetNames
    .map((name) => {
      const norm = normalizeSheetName(name);
      let score = 0;
      if (norm === "capital structure") score = 100;
      else if (norm === "cap structure" || norm === "cap. structure") score = 95;
      else if (norm.includes("capital structure")) score = 90;
      else if (norm === "debt detail" || norm === "debt summary") score = 80;
      else if (norm.includes("capital") && norm.includes("structure")) score = 85;
      return { name, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.name ?? sheetNames[0] ?? null;
}

function matchColumnKey(header: string): ColumnKey | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  for (const [key, patterns] of Object.entries(COLUMN_ALIASES) as [ColumnKey, RegExp[]][]) {
    if (patterns.some((re) => re.test(norm))) return key;
  }
  return null;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function isLikelyCusip(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{8,9}$/.test(compact);
}

function isLikelyIsin(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{10,12}$/.test(compact);
}

function parseMaturity(value: string): { date: string | null; label: string | null } {
  const trimmed = value.trim();
  if (!trimmed || /^(n\/a|na|not disclosed|tbd|-+|—)$/i.test(trimmed)) {
    return { date: null, label: null };
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return { date: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, label: trimmed };
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    const date = `${year}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
    return { date, label: trimmed };
  }

  const monthYear = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthYear) {
    const parsed = Date.parse(`${monthYear[1]} 1, ${monthYear[2]}`);
    if (Number.isFinite(parsed)) {
      const d = new Date(parsed);
      const iso = d.toISOString().slice(0, 10);
      return { date: iso, label: trimmed };
    }
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return { date: `${yearOnly[1]}-12-31`, label: trimmed };
  }

  return { date: null, label: trimmed };
}

function inferInstrumentType(name: string, rawType: string | null): string | null {
  if (rawType) return rawType;
  const n = name.toLowerCase();
  if (/\brevolv(er|ing)\b/.test(n)) return "Revolver";
  if (/\bterm\s+[a-z]\s+facility\b|\bterm\s+[a-z]\b.*\bfacility\b/.test(n)) return "Term Loan";
  if (/\bterm\s*loan\b/.test(n)) return "Term Loan";
  if (/\bfacility\b/.test(n) && /\bterm\b/.test(n)) return "Term Loan";
  if (/\bsr\.?\s*unsec\.?\b|\bsenior\s*unsecured\b/.test(n)) return "Senior Unsecured Notes";
  if (/\bsr\.?\s*sec\.?\s*notes?\b|\bsenior\s*secured\s*notes?\b/.test(n)) return "Senior Secured Notes";
  if (/\bsr\.?\s*unsec\.?\s*notes?\b|\bsenior\s*unsecured\s*notes?\b/.test(n)) return "Senior Unsecured Notes";
  if (/\bunsecured\s*notes?\b/.test(n)) return "Unsecured Notes";
  if (/\bnotes?\b/.test(n)) return "Notes";
  if (/\bfacility\b/.test(n)) return "Credit Facility";
  if (/\bloan\b/.test(n)) return "Term Loan";
  return null;
}

function extractCouponMaturityFromName(name: string): {
  coupon: string | null;
  maturityLabel: string | null;
  maturityDate: string | null;
} {
  const couponMatch = name.match(/(^|\s)([\d.]+%)/);
  const coupon = couponMatch?.[2] ?? null;

  const dueMatch = name.match(/\bdue\s+([A-Za-z]+\s+\d{4}|\d{4})\b/i);
  if (dueMatch?.[1]) {
    const maturity = parseMaturity(dueMatch[1]);
    return { coupon, maturityLabel: dueMatch[1], maturityDate: maturity.date };
  }

  return { coupon, maturityLabel: null, maturityDate: null };
}

function isSectionHeaderRow(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^(senior|total|subtotal|gross|net)\b/i.test(trimmed) && trimmed.length > 45) return true;
  if (/credit agreement|pari passu|first lien\)$/i.test(trimmed)) return true;
  if (trimmed.includes("—") && !/\b(due|notes|loan|facility|revolv|term)\b/i.test(trimmed)) return true;
  return false;
}

function isRowIndexValue(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function resolveNameColumnIndex(rows: string[][], headerRowIndex: number, columnMap: Partial<Record<ColumnKey, number>>): number {
  const mapped = columnMap.name;
  if (mapped == null) return 0;

  let indexLike = 0;
  let textLike = 0;
  for (let i = headerRowIndex + 1; i < Math.min(rows.length, headerRowIndex + 20); i++) {
    const row = rows[i] ?? [];
    const mappedVal = cellText(row[mapped]);
    if (!mappedVal) continue;
    if (isRowIndexValue(mappedVal)) indexLike += 1;
    else textLike += 1;
  }

  if (indexLike > textLike && mapped + 1 < (rows[headerRowIndex]?.length ?? 0)) {
    return mapped + 1;
  }
  return mapped;
}

function normalizeLienLevel(raw: string | null, name: string, structural: string | null): string | null {
  const combined = `${raw ?? ""} ${name} ${structural ?? ""}`.toLowerCase();
  if (/\b1l\b|first\s*lien|1st\s*lien/.test(combined)) return "1st Lien";
  if (/\b2l\b|second\s*lien|2nd\s*lien/.test(combined)) return "2nd Lien";
  if (/\bjunior\s*lien|3rd\s*lien|third\s*lien/.test(combined)) return "Junior Lien";
  if (/\bunsecured\b/.test(combined)) return "Unsecured";
  if (/\bsecured\b/.test(combined)) return "Secured";
  return raw?.trim() || null;
}

function inferLienLevel(name: string, rawLien: string | null, structural: string | null): string | null {
  return normalizeLienLevel(rawLien, name, structural);
}

function isSummaryRow(name: string, row: string[]): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (isSectionHeaderRow(trimmed)) return true;
  if (SUMMARY_ROW_PATTERN.test(trimmed)) return true;
  if (/^total\b/i.test(trimmed)) return true;
  if (/leverage$/i.test(trimmed) && row.filter(Boolean).length <= 3) return true;
  return false;
}

function detectHeaderRow(rows: string[][]): { headerRowIndex: number; columnMap: Partial<Record<ColumnKey, number>> } {
  let bestIndex = -1;
  let bestScore = 0;
  let bestMap: Partial<Record<ColumnKey, number>> = {};

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] ?? [];
    const map: Partial<Record<ColumnKey, number>> = {};
    let score = 0;
    for (let col = 0; col < row.length; col++) {
      const key = matchColumnKey(row[col] ?? "");
      if (key && map[key] == null) {
        map[key] = col;
        score += 1;
      }
    }
    if (map.name != null) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
      bestMap = map;
    }
  }

  if (bestIndex < 0 || bestMap.name == null) {
    return { headerRowIndex: 0, columnMap: { name: 0 } };
  }
  return { headerRowIndex: bestIndex, columnMap: bestMap };
}

function readMappedCell(row: string[], columnMap: Partial<Record<ColumnKey, number>>, key: ColumnKey): string {
  const idx = columnMap[key];
  if (idx == null) return "";
  return cellText(row[idx]);
}

export function parseCapitalStructureSheetRows(rows: string[][]): ParsedCapitalStructureSecurity[] {
  if (!rows.length) return [];

  const { headerRowIndex, columnMap } = detectHeaderRow(rows);
  const nameCol = resolveNameColumnIndex(rows, headerRowIndex, columnMap);
  const results: ParsedCapitalStructureSecurity[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = (rows[i] ?? []).map((cell) => cellText(cell));
    const name = cellText(row[nameCol]);
    if (isSummaryRow(name, row)) continue;

    let cusip = readMappedCell(row, columnMap, "cusip") || null;
    let isin = readMappedCell(row, columnMap, "isin") || null;

    if (cusip && isLikelyIsin(cusip) && !isin) {
      isin = cusip;
      cusip = null;
    }
    if (cusip && !isLikelyCusip(cusip) && !isLikelyIsin(cusip)) {
      if (/^(n\/a|na|tbd|-+|—)$/i.test(cusip)) cusip = null;
    }
    if (cusip && isLikelyCusip(cusip)) {
      cusip = cusip.replace(/[\s-]/g, "").toUpperCase();
    } else if (cusip && !isLikelyCusip(cusip)) {
      cusip = null;
    }

    const maturityRaw = readMappedCell(row, columnMap, "maturity");
    const maturity = parseMaturity(maturityRaw);
    const fromName = extractCouponMaturityFromName(name);
    const structuralRanking = readMappedCell(row, columnMap, "structuralRanking") || null;
    const instrumentType = inferInstrumentType(name, readMappedCell(row, columnMap, "instrumentType") || null);
    const lienLevel = inferLienLevel(name, readMappedCell(row, columnMap, "lienLevel") || null, structuralRanking);

    results.push({
      name,
      cusip,
      isin: isin || null,
      instrumentType,
      lienLevel,
      structuralRanking,
      issuer: readMappedCell(row, columnMap, "issuer") || null,
      coupon: readMappedCell(row, columnMap, "coupon") || fromName.coupon,
      price: readMappedCell(row, columnMap, "price") || null,
      yieldToMaturity: readMappedCell(row, columnMap, "yieldToMaturity") || null,
      faceAmount: readMappedCell(row, columnMap, "faceAmount") || null,
      currency: readMappedCell(row, columnMap, "currency") || null,
      maturityDate: maturity.date ?? fromName.maturityDate,
      maturityLabel: maturity.label ?? fromName.maturityLabel,
      sourceRowIndex: i,
    });
  }

  return results;
}

export function rowHasImportableCusip(cusip: string | null | undefined): boolean {
  const trimmed = (cusip ?? "").trim();
  if (!trimmed) return false;
  return !/^(n\/a|na|not disclosed|tbd|-+|—)$/i.test(trimmed);
}

export function filterImportableCapitalStructureSecurities(
  securities: ParsedCapitalStructureSecurity[]
): ParsedCapitalStructureSecurity[] {
  return securities.filter((row) => rowHasImportableCusip(row.cusip));
}

export function parseCapitalStructureInstrumentsFromBuffer(buf: Buffer): {
  sheetName: string | null;
  securities: ParsedCapitalStructureSecurity[];
} {
  if (!buf.length) return { sheetName: null, securities: [] };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch {
    return { sheetName: null, securities: [] };
  }

  const sheetName = findCapitalStructureSheetName(wb.SheetNames);
  if (!sheetName) return { sheetName: null, securities: [] };

  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { sheetName, securities: [] };

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as string[][];

  return {
    sheetName,
    securities: parseCapitalStructureSheetRows(rows),
  };
}
