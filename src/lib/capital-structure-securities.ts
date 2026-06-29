import { prisma } from "@/lib/prisma";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  getCapitalStructureExcelBuffer,
  listCapitalStructureExcels,
} from "@/lib/capital-structure-excel";
import { parseCapitalStructureInstrumentsFromBuffer, filterImportableCapitalStructureSecurities } from "@/lib/capital-structure-excel-parse";

export type CapitalStructureSecurityDto = {
  id: string;
  ticker: string;
  name: string;
  cusip: string | null;
  cusipManuallySet: boolean;
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
  sourceExcelFile: string | null;
  sourceRowIndex: number | null;
  sortOrder: number;
  userEdited: boolean;
  isConfirmed: boolean;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: {
  id: string;
  ticker: string;
  name: string;
  cusip: string | null;
  cusipManuallySet: boolean;
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
  maturityDate: Date | null;
  maturityLabel: string | null;
  sourceExcelFile: string | null;
  sourceRowIndex: number | null;
  sortOrder: number;
  userEdited: boolean;
  isConfirmed: boolean;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CapitalStructureSecurityDto {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    cusip: row.cusip,
    cusipManuallySet: row.cusipManuallySet,
    isin: row.isin,
    instrumentType: row.instrumentType,
    lienLevel: row.lienLevel,
    structuralRanking: row.structuralRanking,
    issuer: row.issuer,
    coupon: row.coupon,
    price: row.price,
    yieldToMaturity: row.yieldToMaturity,
    faceAmount: row.faceAmount,
    currency: row.currency,
    maturityDate: row.maturityDate?.toISOString().slice(0, 10) ?? null,
    maturityLabel: row.maturityLabel,
    sourceExcelFile: row.sourceExcelFile,
    sourceRowIndex: row.sourceRowIndex,
    sortOrder: row.sortOrder,
    userEdited: row.userEdited,
    isConfirmed: row.isConfirmed,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function listCapitalStructureSecurities(
  userId: string,
  ticker: string,
  options?: { confirmedOnly?: boolean }
): Promise<CapitalStructureSecurityDto[] | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;

  const rows = await prisma.capitalStructureSecurity.findMany({
    where: {
      userId,
      ticker: safeTicker,
      ...(options?.confirmedOnly ? { isConfirmed: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDto);
}

export async function listConfirmedCapitalStructureSecurities(
  userId: string,
  ticker: string
): Promise<CapitalStructureSecurityDto[] | null> {
  return listCapitalStructureSecurities(userId, ticker, { confirmedOnly: true });
}

export async function syncCapitalStructureSecuritiesFromExcel(
  userId: string,
  ticker: string,
  excelFilename?: string | null
): Promise<
  | {
      ok: true;
      securities: CapitalStructureSecurityDto[];
      sheetName: string | null;
      sourceExcelFile: string;
      parsedCount: number;
    }
  | { ok: false; error: string }
> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  let filename = excelFilename?.trim() || "";
  if (!filename) {
    const items = await listCapitalStructureExcels(userId, safeTicker);
    filename = items?.[0]?.filename ?? "";
  }
  if (!filename) {
    return { ok: false, error: "No capital structure Excel file found. Upload a workbook first." };
  }

  const buf = await getCapitalStructureExcelBuffer(userId, safeTicker, filename);
  if (!buf) return { ok: false, error: "Excel file not found." };

  const { sheetName, securities: parsed } = parseCapitalStructureInstrumentsFromBuffer(buf);
  const importable = filterImportableCapitalStructureSecurities(parsed);

  if (!parsed.length) {
    return {
      ok: false,
      error: sheetName
        ? `No instrument rows found on "${sheetName}" sheet. Check that the Capital Structure tab has a header row with an Instrument column.`
        : "Could not find a Capital Structure sheet in the workbook.",
    };
  }

  if (!importable.length) {
    return {
      ok: false,
      error: sheetName
        ? `Found ${parsed.length} rows on "${sheetName}" but none have a CUSIP. Add a CUSIP column and fill CUSIPs for each bond/note/security — only rows with CUSIPs are imported.`
        : "No rows with CUSIPs found. Add CUSIPs for each tradable security in the Capital Structure sheet.",
    };
  }

  const existing = await prisma.capitalStructureSecurity.findMany({
    where: { userId, ticker: safeTicker },
  });

  const kept = existing.filter((row) => row.isConfirmed || row.userEdited);
  const keptIds = kept.map((row) => row.id);
  const keptNames = new Set(kept.map((row) => normalizeName(row.name)));
  const keptCusips = new Set(
    kept.map((row) => row.cusip?.trim().toUpperCase()).filter((c): c is string => Boolean(c))
  );

  await prisma.$transaction(async (tx) => {
    await tx.capitalStructureSecurity.deleteMany({
      where: {
        userId,
        ticker: safeTicker,
        ...(keptIds.length > 0 ? { id: { notIn: keptIds } } : {}),
      },
    });

    const toCreate = importable.filter((item) => {
      const norm = normalizeName(item.name);
      if (keptNames.has(norm)) return false;
      const cusip = item.cusip?.trim().toUpperCase();
      if (cusip && keptCusips.has(cusip)) return false;
      return true;
    });

    if (toCreate.length > 0) {
      const baseOrder = kept.length;
      await tx.capitalStructureSecurity.createMany({
        data: toCreate.map((item, index) => ({
          userId,
          ticker: safeTicker,
          name: item.name,
          cusip: item.cusip,
          cusipManuallySet: false,
          isin: item.isin,
          instrumentType: item.instrumentType,
          lienLevel: item.lienLevel,
          structuralRanking: item.structuralRanking,
          issuer: item.issuer,
          coupon: item.coupon,
          price: item.price,
          yieldToMaturity: item.yieldToMaturity,
          faceAmount: item.faceAmount,
          currency: item.currency ?? "USD",
          maturityDate: parseDate(item.maturityDate),
          maturityLabel: item.maturityLabel,
          sourceExcelFile: filename,
          sourceRowIndex: item.sourceRowIndex,
          sortOrder: baseOrder + index,
          userEdited: false,
          isConfirmed: Boolean(item.cusip?.trim()),
          confirmedAt: item.cusip?.trim() ? new Date() : null,
        })),
      });
    }
  });

  const securities = (await listCapitalStructureSecurities(userId, safeTicker)) ?? [];
  return {
    ok: true,
    securities,
    sheetName,
    sourceExcelFile: filename,
    parsedCount: importable.length,
  };
}

export async function updateCapitalStructureSecurity(
  userId: string,
  ticker: string,
  securityId: string,
  data: Partial<{
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
  }>
): Promise<CapitalStructureSecurityDto | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;

  const existing = await prisma.capitalStructureSecurity.findFirst({
    where: { id: securityId, userId, ticker: safeTicker },
  });
  if (!existing) return null;

  const cusipProvided = "cusip" in data;
  const nextCusip = cusipProvided ? (data.cusip?.trim() || null) : existing.cusip;
  const cusipManuallySet =
    cusipProvided && nextCusip !== existing.cusip ? true : existing.cusipManuallySet;
  const isConfirmed = Boolean(nextCusip);
  const confirmedAt =
    isConfirmed && !existing.isConfirmed
      ? new Date()
      : isConfirmed
        ? existing.confirmedAt
        : null;

  const updated = await prisma.capitalStructureSecurity.update({
    where: { id: securityId },
    data: {
      userEdited: true,
      isConfirmed,
      confirmedAt,
      ...(data.name != null ? { name: data.name.trim() } : {}),
      ...(cusipProvided ? { cusip: nextCusip, cusipManuallySet } : {}),
      ...(data.isin !== undefined ? { isin: data.isin?.trim() || null } : {}),
      ...(data.instrumentType !== undefined ? { instrumentType: data.instrumentType?.trim() || null } : {}),
      ...(data.lienLevel !== undefined ? { lienLevel: data.lienLevel?.trim() || null } : {}),
      ...(data.structuralRanking !== undefined
        ? { structuralRanking: data.structuralRanking?.trim() || null }
        : {}),
      ...(data.issuer !== undefined ? { issuer: data.issuer?.trim() || null } : {}),
      ...(data.coupon !== undefined ? { coupon: data.coupon?.trim() || null } : {}),
      ...(data.price !== undefined ? { price: data.price?.trim() || null } : {}),
      ...(data.yieldToMaturity !== undefined ? { yieldToMaturity: data.yieldToMaturity?.trim() || null } : {}),
      ...(data.faceAmount !== undefined ? { faceAmount: data.faceAmount?.trim() || null } : {}),
      ...(data.currency !== undefined ? { currency: data.currency?.trim() || null } : {}),
      ...(data.maturityDate !== undefined ? { maturityDate: parseDate(data.maturityDate) } : {}),
      ...(data.maturityLabel !== undefined ? { maturityLabel: data.maturityLabel?.trim() || null } : {}),
    },
  });

  return toDto(updated);
}

export async function deleteCapitalStructureSecurity(
  userId: string,
  ticker: string,
  securityId: string
): Promise<boolean> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return false;

  const existing = await prisma.capitalStructureSecurity.findFirst({
    where: { id: securityId, userId, ticker: safeTicker },
  });
  if (!existing) return false;

  await prisma.capitalStructureSecurity.delete({ where: { id: securityId } });
  return true;
}
