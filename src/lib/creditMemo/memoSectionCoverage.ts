import type { MemoOutline } from "./types";

export const MEMO_SECTION_PLACEHOLDER = "[need additional information]";

function normalizeSectionTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Split markdown on ## headings (level 2 only; ### stays inside body). */
export function parseMarkdownH2Sections(markdown: string): {
  preamble: string;
  sections: { title: string; body: string }[];
} {
  const text = markdown.replace(/\r\n/g, "\n").trimEnd();
  if (!text) return { preamble: "", sections: [] };

  const blocks = text.split(/\n(?=^## (?!#))/m);
  let preamble = "";
  const sections: { title: string; body: string }[] = [];

  for (const block of blocks) {
    const trimmed = block.trimStart();
    const m = trimmed.match(/^## (?!#)([^\n]+)\n?([\s\S]*)$/);
    if (m) {
      sections.push({ title: m[1].trim(), body: (m[2] ?? "").trimEnd() });
    } else if (sections.length === 0) {
      preamble = block.trimEnd();
    } else {
      const last = sections[sections.length - 1];
      last.body = `${last.body}\n\n${block.trim()}`.trimEnd();
    }
  }

  return { preamble, sections };
}

/**
 * Ensures every outline section appears as ## <title> in order using canonical titles from the outline.
 * Missing sections get MEMO_SECTION_PLACEHOLDER. Preserves preamble and extra ## sections not in the outline.
 */
export function ensureAllOutlineSectionsInMarkdown(markdown: string, outline: MemoOutline): string {
  if (!outline.sections.length) return markdown.trimEnd() + (markdown.endsWith("\n") ? "" : "\n");

  const { preamble, sections: found } = parseMarkdownH2Sections(markdown);
  const used = new Set<number>();

  const out: string[] = [];
  if (preamble) out.push(preamble);

  for (const exp of outline.sections) {
    const key = normalizeSectionTitle(exp.title);
    let idx = -1;
    for (let i = 0; i < found.length; i++) {
      if (used.has(i)) continue;
      if (normalizeSectionTitle(found[i].title) === key) {
        idx = i;
        break;
      }
    }

    if (idx >= 0) {
      used.add(idx);
      const bodyRaw = found[idx].body.trim();
      const body = bodyRaw.length === 0 ? MEMO_SECTION_PLACEHOLDER : found[idx].body.trimEnd();
      out.push(`## ${exp.title}\n\n${body}`.trimEnd());
    } else {
      out.push(`## ${exp.title}\n\n${MEMO_SECTION_PLACEHOLDER}`);
    }
  }

  for (let i = 0; i < found.length; i++) {
    if (used.has(i)) continue;
    const s = found[i];
    const inOutline = outline.sections.some((e) => normalizeSectionTitle(e.title) === normalizeSectionTitle(s.title));
    if (!inOutline) {
      const body = s.body.trim().length === 0 ? MEMO_SECTION_PLACEHOLDER : s.body.trimEnd();
      out.push(`## ${s.title}\n\n${body}`.trimEnd());
    }
  }

  return out.join("\n\n").trim() + "\n";
}
