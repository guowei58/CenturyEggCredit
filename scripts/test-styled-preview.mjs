import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import JSZip from "jszip";
import XLSX from "xlsx-js-style";

async function parseStyleIndexes(buf, sheetPath) {
  const map = new Map();
  if (!sheetPath) return map;
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(sheetPath.replace(/^\//, "")) ?? zip.file(sheetPath);
  if (!file) return map;
  const xml = await file.async("string");
  for (const tag of xml.matchAll(/<c\b[^>]*\/?>/gi)) {
    const addr = tag[0].match(/\br="([A-Z]+[0-9]+)"/i)?.[1];
    const style = tag[0].match(/\bs="(\d+)"/)?.[1];
    if (addr && style) map.set(addr.toUpperCase(), Number.parseInt(style, 10));
  }
  return map;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Capital Structure");
  ws.mergeCells("A1:N1");
  const title = ws.getCell("A1");
  title.value = "NXST Capital Structure";
  title.font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFCC" } };
  const h = ws.getRow(3);
  h.getCell(1).value = "Key Assumption";
  h.getCell(1).font = { bold: true, color: { argb: "FFB4C7E7" } };
  h.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A4A4A" } };
  ws.getCell("A4").value = "Plain row";
  ws.getCell("A4").font = { color: { argb: "FF0070C0" } };

  const tmp = join(tmpdir(), "style-test.xlsx");
  await wb.xlsx.writeFile(tmp);
  const buf = readFileSync(tmp);

  const xwb = XLSX.read(buf, { type: "buffer", cellStyles: true });
  const sheetPath = xwb.Directory?.sheets?.[0];
  const styleIdx = await parseStyleIndexes(buf, sheetPath);
  const xws = xwb.Sheets["Capital Structure"];

  // Simulate resolver: no default xf 0 for A4 if missing from map
  console.log("A1 idx", styleIdx.get("A1"), "partial", xws.A1?.s);
  console.log("A3 idx", styleIdx.get("A3"), "partial", xws.A3?.s);
  console.log("A4 idx", styleIdx.get("A4"), "partial", xws.A4?.s);

  unlinkSync(tmp);
}

main();
