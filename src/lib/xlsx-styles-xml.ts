import JSZip from "jszip";

import type { PreviewBorderSide, PreviewCellBorders } from "@/lib/excel-workbook-preview";

type ColorRef = { rgb?: string; theme?: number; tint?: number; indexed?: number };

export type XlsxBorderSideXml = {
  style?: string;
  color?: ColorRef;
};

export type XlsxBorderDef = {
  top?: XlsxBorderSideXml;
  right?: XlsxBorderSideXml;
  bottom?: XlsxBorderSideXml;
  left?: XlsxBorderSideXml;
};

function parseSideTag(sideXml: string): XlsxBorderSideXml | undefined {
  const style = sideXml.match(/\bstyle="([^"]+)"/i)?.[1];
  const rgb = sideXml.match(/<color\b[^>]*\brgb="([^"]+)"/i)?.[1];
  const theme = sideXml.match(/<color\b[^>]*\btheme="(\d+)"/i)?.[1];
  const tint = sideXml.match(/<color\b[^>]*\btint="([^"]+)"/i)?.[1];
  if (!style && !rgb && theme == null) return undefined;

  const color: ColorRef = {};
  if (rgb) color.rgb = rgb;
  if (theme != null) color.theme = Number.parseInt(theme, 10);
  if (tint != null) color.tint = Number.parseFloat(tint);

  return {
    style: style?.toLowerCase(),
    color: rgb || theme != null ? color : undefined,
  };
}

function parseBorderBlock(borderXml: string): XlsxBorderDef {
  const def: XlsxBorderDef = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const match = borderXml.match(new RegExp(`<${side}\\b([^>]*)>([\\s\\S]*?)<\\/${side}>`, "i"));
    if (!match) continue;
    const parsed = parseSideTag(`${match[1] ?? ""}${match[2] ?? ""}`);
    if (parsed?.style && parsed.style !== "none") def[side] = parsed;
  }
  return def;
}

/** xlsx-js-style leaves Styles.Borders empty — parse xl/styles.xml directly. */
export async function parseWorkbookBordersFromStylesXml(
  buf: Buffer | ArrayBuffer
): Promise<XlsxBorderDef[]> {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const zip = await JSZip.loadAsync(data);
  const stylesFile = zip.file("xl/styles.xml");
  if (!stylesFile) return [{}];

  const xml = await stylesFile.async("string");
  const bordersMatch = xml.match(/<borders\b[^>]*>([\s\S]*?)<\/borders>/i);
  if (!bordersMatch) return [{}];

  const blocks = bordersMatch[1].match(/<border\b[^>]*>[\s\S]*?<\/border>/gi) ?? [];
  if (blocks.length === 0) return [{}];
  return blocks.map(parseBorderBlock);
}

export function excelBorderSideToPreviewSide(
  side: XlsxBorderSideXml | undefined,
  resolveColor: (color: ColorRef | undefined) => string | undefined
): PreviewBorderSide | undefined {
  if (!side?.style || side.style === "none") return undefined;

  const styleName = side.style.toLowerCase();
  let widthPx = 1;
  let lineStyle: PreviewBorderSide["lineStyle"] = "solid";

  switch (styleName) {
    case "hair":
      widthPx = 1;
      break;
    case "thin":
      widthPx = 1;
      break;
    case "medium":
    case "mediumdashdot":
    case "mediumdashdotdot":
    case "mediumdashed":
      widthPx = 2;
      break;
    case "thick":
      widthPx = 3;
      break;
    case "double":
      widthPx = 3;
      lineStyle = "double";
      break;
    case "dashed":
    case "dashdot":
    case "dashdotdot":
    case "slanteddashdot":
      lineStyle = "dashed";
      break;
    case "dotted":
      lineStyle = "dotted";
      break;
    default:
      widthPx = 1;
      break;
  }

  const color = resolveColor(side.color) ?? "#000000";
  return { widthPx, lineStyle, color };
}

export function resolvePreviewBorders(
  borderDef: XlsxBorderDef | undefined,
  resolveColor: (color: ColorRef | undefined) => string | undefined
): PreviewCellBorders | undefined {
  if (!borderDef) return undefined;

  const top = excelBorderSideToPreviewSide(borderDef.top, resolveColor);
  const right = excelBorderSideToPreviewSide(borderDef.right, resolveColor);
  const bottom = excelBorderSideToPreviewSide(borderDef.bottom, resolveColor);
  const left = excelBorderSideToPreviewSide(borderDef.left, resolveColor);

  if (!top && !right && !bottom && !left) return undefined;
  return { top, right, bottom, left };
}
