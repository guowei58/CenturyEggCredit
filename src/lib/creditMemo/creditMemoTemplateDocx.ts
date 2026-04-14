import mammoth from "mammoth";

import { normalizeSectionTitle } from "./memoSectionCoverage";
import type { CreditMemoTemplate } from "./types";

function stripHtmlTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

function parseHeadingTags(html: string): Array<{ level: HeadingLevel; title: string }> {
  const out: Array<{ level: HeadingLevel; title: string }> = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of Array.from(html.matchAll(re))) {
    const tag = (m[1] || "").toLowerCase();
    const raw = m[2] || "";
    const title = stripHtmlTags(raw);
    if (!title) continue;
    const n = Number.parseInt(tag.slice(1), 10);
    const level = (Number.isFinite(n) && n >= 1 && n <= 6 ? n : 3) as HeadingLevel;
    out.push({ level, title: title.slice(0, 140) });
  }
  return out;
}

/**
 * For each title in outlineTitles (deduped heading list), take plain text after that heading in the HTML
 * until the next heading — gives the model concrete “what belongs here” from the firm template.
 */
export function extractSectionHintsFromHtml(html: string, outlineTitles: string[]): string[] {
  const normalizedTargets = outlineTitles.map((t) => normalizeSectionTitle(t));
  const hints = outlineTitles.map(() => "");
  const used = new Set<number>();

  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches: { start: number; title: string; endOfHeading: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) !== null) {
    const title = stripHtmlTags(m[2] || "").slice(0, 140);
    matches.push({ start: m.index, title, endOfHeading: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].endOfHeading;
    const end = i + 1 < matches.length ? matches[i + 1].start : html.length;
    const bodySlice = html.slice(start, end);
    const hint = stripHtmlTags(bodySlice).replace(/\s+/g, " ").trim().slice(0, 500);

    const nt = normalizeSectionTitle(matches[i].title);
    const ti = normalizedTargets.findIndex((t, idx) => t === nt && !used.has(idx));
    if (ti >= 0) {
      used.add(ti);
      if (hint) hints[ti] = hint;
    }
  }
  return hints;
}

function buildOutlineTitles(headings: Array<{ level: HeadingLevel; title: string }>): string[] {
  const titles = headings
    .filter((h) => h.title.trim().length >= 3)
    .map((h) => h.title.replace(/\s+/g, " ").trim());
  const out: string[] = [];
  for (const t of titles) {
    if (!out.length || out[out.length - 1]!.toLowerCase() !== t.toLowerCase()) out.push(t);
  }
  return out;
}

export async function buildCreditMemoTemplateFromDocxBytes(params: {
  buffer: Buffer;
  id: string;
  filename: string;
  uploadedAt: string;
}): Promise<CreditMemoTemplate> {
  const htmlRes = await mammoth.convertToHtml({ buffer: params.buffer });
  const html = htmlRes.value || "";
  const headings = parseHeadingTags(html);
  const outlineTitles = buildOutlineTitles(headings);
  const sectionHints = outlineTitles.length ? extractSectionHintsFromHtml(html, outlineTitles) : [];

  return {
    id: params.id,
    filename: params.filename,
    uploadedAt: params.uploadedAt,
    headings,
    outlineTitles,
    sectionHints,
  };
}
