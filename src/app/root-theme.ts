import type { CSSProperties } from "react";

/**
 * Inline fallbacks on <html> so the UI stays readable if bundled CSS fails to load
 * (broken .next cache, blocked stylesheet, etc.).
 */
export const rootThemeVars = {
  "--bg": "#07090d",
  "--sb": "#0b0e14",
  "--panel": "#0e1219",
  "--card": "#121920",
  "--card2": "#161e28",
  "--border": "#1c2a3a",
  "--border2": "#253649",
  "--accent": "#00d4aa",
  "--blue": "#3b82f6",
  "--purple": "#8b5cf6",
  "--warn": "#f59e0b",
  "--danger": "#ef4444",
  "--green": "#22c55e",
  "--pink": "#ec4899",
  "--text": "#e2e8f4",
  "--muted": "#64748b",
  "--muted2": "#94a3b8",
} as const satisfies Record<string, string>;

export const rootHtmlStyle = rootThemeVars as unknown as CSSProperties;
