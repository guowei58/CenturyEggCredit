import fs from "fs";
import path from "path";

import { buildCreditMemoTemplateFromDocxBytes } from "./creditMemoTemplateDocx";
import type { CreditMemoTemplate } from "./types";

/** Stable id for the bundled / env-configured default memo outline (not stored per user). */
export const PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID = "__ceg_public_default_v1__";

const DEFAULT_DISPLAY_FILENAME = "Century Egg — default credit memo outline.docx";

let cached: { template: CreditMemoTemplate; resolvedPath: string; mtimeMs: number } | null = null;

export function resolvePublicDefaultCreditMemoDocxPath(): string | null {
  const env = process.env.CREDIT_MEMO_PUBLIC_TEMPLATE_PATH?.trim();
  if (env && fs.existsSync(env)) return path.resolve(env);
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "credit-memo-defaults", "default-memo-outline.docx"),
    path.join(cwd, "default-memo-outline.docx"),
    path.join(cwd, "Credit Memo Outline.docx"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readPublicDefaultCreditMemoDocxBuffer(): Buffer | null {
  const p = resolvePublicDefaultCreditMemoDocxPath();
  if (!p) return null;
  return fs.readFileSync(p);
}

export async function loadPublicDefaultCreditMemoTemplate(): Promise<CreditMemoTemplate | null> {
  const p = resolvePublicDefaultCreditMemoDocxPath();
  if (!p) return null;
  const st = fs.statSync(p);
  if (cached && cached.resolvedPath === p && cached.mtimeMs === st.mtimeMs) {
    return { ...cached.template, isPublicDefault: true };
  }
  const buf = fs.readFileSync(p);
  const uploadedAt = new Date(st.mtimeMs).toISOString();
  const template = await buildCreditMemoTemplateFromDocxBytes({
    buffer: Buffer.from(buf),
    id: PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID,
    filename: DEFAULT_DISPLAY_FILENAME,
    uploadedAt,
  });
  const withFlag: CreditMemoTemplate = { ...template, isPublicDefault: true };
  cached = { template: withFlag, resolvedPath: p, mtimeMs: st.mtimeMs };
  return withFlag;
}
