import JSZip from "jszip";

/** Parse worksheet XML and return cell address -> xf style index. */
export async function parseWorksheetCellStyleIndexes(
  buf: Buffer | ArrayBuffer,
  sheetPath: string | undefined
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!sheetPath) return map;

  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const zip = await JSZip.loadAsync(data);
  const normalized = sheetPath.replace(/^\//, "");
  const file = zip.file(normalized) ?? zip.file(sheetPath);
  if (!file) return map;

  const xml = await file.async("string");
  const tagRe = /<c\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml))) {
    const tag = match[0];
    const addr = tag.match(/\br="([A-Z]+[0-9]+)"/i)?.[1];
    const style = tag.match(/\bs="(\d+)"/)?.[1];
    if (addr && style != null) map.set(addr.toUpperCase(), Number.parseInt(style, 10));
  }
  return map;
}

export function worksheetPathForSheetName(
  wb: { SheetNames?: string[]; Directory?: { sheets?: string[] } },
  sheetName: string
): string | undefined {
  const idx = wb.SheetNames?.indexOf(sheetName) ?? -1;
  if (idx < 0) return undefined;
  return wb.Directory?.sheets?.[idx];
}
