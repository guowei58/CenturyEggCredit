import type { PreviewCell, PreviewCellBorders } from "@/lib/excel-workbook-preview";
import {
  resolvePreviewBorders,
  type XlsxBorderDef,
} from "@/lib/xlsx-styles-xml";

type ColorRef = { rgb?: string; theme?: number; tint?: number; indexed?: number };
type XlsxStyles = {
  CellXf?: Array<Record<string, unknown>>;
  Fonts?: Array<Record<string, unknown>>;
  Fills?: Array<Record<string, unknown>>;
};

const THEME_DEFAULTS = [
  "#FFFFFF",
  "#000000",
  "#EEECE1",
  "#1F497D",
  "#4F81BD",
  "#C0504D",
  "#9BBB59",
  "#8064A2",
  "#4BACC6",
  "#F79646",
  "#0563C1",
  "#954F72",
];

/** Excel legacy indexed palette (first 64 entries). */
const INDEXED_COLORS = [
  "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
  "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
  "#800000", "#008000", "#000080", "#808000", "#800080", "#008080", "#C0C0C0", "#808080",
  "#9999FF", "#993366", "#FFFFCC", "#CCFFFF", "#660066", "#FF8080", "#0066CC", "#CCCCFF",
  "#000080", "#FF00FF", "#FFFF00", "#00FFFF", "#800080", "#800000", "#008080", "#0000FF",
  "#00CCFF", "#CCFFFF", "#CCFFCC", "#FFFF99", "#99CCFF", "#FF99CC", "#CC99FF", "#FFCC99",
  "#3366FF", "#33CCCC", "#99CC00", "#FFCC00", "#FF9900", "#FF6600", "#666699", "#969696",
  "#003366", "#339966", "#003300", "#333300", "#993300", "#993366", "#333399", "#333333",
];

function applyTint(hex: string, tint: number): string {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => {
    if (tint < 0) return Math.round(c * (1 + tint));
    return Math.round(c + (255 - c) * tint);
  };
  const rr = Math.min(255, Math.max(0, mix(r)));
  const gg = Math.min(255, Math.max(0, mix(g)));
  const bb = Math.min(255, Math.max(0, mix(b)));
  return `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb.toString(16).padStart(2, "0")}`;
}

function rgbToHex(rgb: string | undefined): string | undefined {
  if (!rgb) return undefined;
  const hex = rgb.replace(/^#/, "").trim();
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(2)}`;
  return undefined;
}

export function resolveXlsxColor(color: ColorRef | undefined, themePalette?: string[]): string | undefined {
  if (!color) return undefined;
  const direct = rgbToHex(color.rgb);
  if (direct) {
    if (color.tint != null && color.tint !== 0) return applyTint(direct, color.tint);
    return direct;
  }
  if (typeof color.indexed === "number") {
    const base = INDEXED_COLORS[color.indexed];
    if (base) return base;
  }
  if (typeof color.theme === "number") {
    const base = themePalette?.[color.theme] ?? THEME_DEFAULTS[color.theme] ?? "#000000";
    if (color.tint != null && color.tint !== 0) return applyTint(base, color.tint);
    return base;
  }
  return undefined;
}

function hexToTextColor(bgHex: string): string {
  const hex = bgHex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#0b0e14";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0b0e14" : "#ffffff";
}

function numId(obj: Record<string, unknown> | undefined, ...keys: string[]): number {
  if (!obj) return 0;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function truthy(obj: Record<string, unknown> | undefined, key: string): boolean {
  if (!obj) return false;
  const v = obj[key];
  return v === true || v === 1 || v === "1";
}

function resolveFillColors(
  fill: { patternType?: string; fgColor?: ColorRef; bgColor?: ColorRef } | undefined,
  themePalette?: string[]
): { bgColor?: string; fillCss?: string; hasBg: boolean } {
  const patternType = fill?.patternType;
  if (patternType == null || patternType === "none" || patternType === "gray125") {
    return { hasBg: false };
  }

  const fg = resolveXlsxColor(fill?.fgColor, themePalette);
  const bg = resolveXlsxColor(fill?.bgColor, themePalette);

  if (patternType === "solid") {
    const bgColor = fg ?? bg;
    return bgColor ? { bgColor, hasBg: true } : { hasBg: false };
  }

  if (fg && bg) {
    return {
      bgColor: bg,
      fillCss: `repeating-linear-gradient(135deg, ${fg} 0 1px, ${bg} 1px 4px)`,
      hasBg: true,
    };
  }

  const approx = fg ?? bg;
  if (!approx) return { hasBg: false };
  return { bgColor: approx, hasBg: true };
}

function fontHasUnderline(font: Record<string, unknown> | undefined): boolean {
  const u = font?.underline;
  return (
    u === true ||
    u === 1 ||
    u === "single" ||
    u === "double" ||
    u === "singleAccounting" ||
    u === "doubleAccounting"
  );
}

function fontHasStrikethrough(font: Record<string, unknown> | undefined): boolean {
  const s = font?.strike ?? font?.strikethrough;
  return s === true || s === 1;
}

export type ResolvePreviewCellStyleOptions = {
  themePalette?: string[];
  borderDefs?: XlsxBorderDef[];
};

export function resolvePreviewCellStyle(
  styles: XlsxStyles | undefined,
  xfIndex: number | undefined,
  partialCellStyle: unknown,
  options?: ResolvePreviewCellStyleOptions
): Pick<
  PreviewCell,
  | "bgColor"
  | "fillCss"
  | "textColor"
  | "hasBg"
  | "wrapText"
  | "textAlign"
  | "verticalAlign"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "indent"
  | "fontSize"
  | "fontFamily"
  | "borders"
  | "hasAnyBorder"
> {
  const themePalette = options?.themePalette;
  const resolveColor = (color: ColorRef | undefined) => resolveXlsxColor(color, themePalette);

  const partial = (partialCellStyle ?? {}) as {
    patternType?: string;
    fgColor?: ColorRef;
    bgColor?: ColorRef;
    fill?: { patternType?: string; fgColor?: ColorRef; bgColor?: ColorRef };
    font?: {
      bold?: boolean | number;
      italic?: boolean | number;
      sz?: number;
      name?: string;
      color?: ColorRef;
      underline?: boolean | number | string;
      strike?: boolean | number;
      strikethrough?: boolean | number;
    };
    alignment?: {
      horizontal?: string;
      vertical?: string;
      wrapText?: boolean | number;
      indent?: number | string;
    };
  };

  let font: Record<string, unknown> | undefined;
  let fill: { patternType?: string; fgColor?: ColorRef; bgColor?: ColorRef } | undefined;
  let alignment:
    | { horizontal?: string; vertical?: string; wrapText?: boolean | number; indent?: number | string }
    | undefined;
  let borderId: number | undefined;

  if (styles && xfIndex != null && xfIndex >= 0) {
    const xf = styles.CellXf?.[xfIndex] as Record<string, unknown> | undefined;
    if (xf) {
      if (truthy(xf, "applyFont")) {
        const fontId = numId(xf, "fontId", "fontid");
        font = styles.Fonts?.[fontId] as Record<string, unknown> | undefined;
      }
      if (truthy(xf, "applyFill")) {
        const fillId = numId(xf, "fillId", "fillid");
        fill = styles.Fills?.[fillId] as typeof fill;
      }
      if (truthy(xf, "applyAlignment") && xf.alignment) {
        alignment = xf.alignment as typeof alignment;
      }
      if (truthy(xf, "applyBorder")) {
        borderId = numId(xf, "borderId", "borderid");
      }
    }
  }

  const partialFill =
    partial.fill ??
    (partial.patternType
      ? { patternType: partial.patternType, fgColor: partial.fgColor, bgColor: partial.bgColor }
      : undefined);

  const fillIsEmpty =
    !fill || fill.patternType == null || fill.patternType === "none" || fill.patternType === "gray125";
  if (fillIsEmpty && partialFill) fill = partialFill;

  if (partial.font) {
    font = font ? { ...font, ...partial.font } : (partial.font as Record<string, unknown>);
  }

  if (partial.alignment) {
    alignment = alignment ? { ...alignment, ...partial.alignment } : partial.alignment;
  }

  const { bgColor, fillCss, hasBg } = resolveFillColors(fill, themePalette);

  const fontColor = resolveColor(font?.color as ColorRef | undefined);
  const textColor = fontColor ?? (bgColor ? hexToTextColor(bgColor) : "#0b0e14");

  const h = alignment?.horizontal;
  const textAlign = h === "center" ? "center" : h === "right" ? "right" : h === "left" ? "left" : undefined;

  const v = alignment?.vertical;
  const verticalAlign =
    v === "center" || v === "middle" ? "middle" : v === "bottom" ? "bottom" : v === "top" ? "top" : undefined;

  const wrapText = alignment?.wrapText === true || alignment?.wrapText === 1;

  const indentRaw = alignment?.indent;
  const indent =
    typeof indentRaw === "number"
      ? indentRaw
      : typeof indentRaw === "string" && indentRaw.trim() !== ""
        ? Number.parseInt(indentRaw, 10)
        : 0;

  const borderDef = borderId != null ? options?.borderDefs?.[borderId] : undefined;
  const borders: PreviewCellBorders | undefined = resolvePreviewBorders(borderDef, resolveColor);
  const hasAnyBorder = Boolean(borders?.top || borders?.right || borders?.bottom || borders?.left);

  return {
    bgColor,
    fillCss,
    textColor,
    hasBg,
    wrapText,
    textAlign,
    verticalAlign,
    bold: font?.bold === true || font?.bold === 1,
    italic: font?.italic === true || font?.italic === 1,
    underline: fontHasUnderline(font),
    strikethrough: fontHasStrikethrough(font),
    indent: Number.isFinite(indent) && indent > 0 ? indent : 0,
    fontSize: typeof font?.sz === "number" && font.sz > 0 ? font.sz : 11,
    fontFamily: typeof font?.name === "string" && font.name.trim() ? font.name.trim() : "Calibri",
    borders,
    hasAnyBorder,
  };
}
