import type { MemoOutline } from "./types";

/** User-message block: template body excerpts so the model aligns substance with the firm DOCX. */
export function buildTemplateDocxHintsBlock(outline: MemoOutline): string {
  const hints = outline.templateSectionHints;
  if (!hints?.length) return "";
  const lines: string[] = [];
  for (let i = 0; i < outline.sections.length; i++) {
    const h = hints[i]?.trim();
    if (!h) continue;
    lines.push(`${i + 1}. **${outline.sections[i].title}** — Under this heading the template contained: ${h}`);
  }
  if (!lines.length) return "";
  return `
# TEMPLATE DOC (what each section is for)
Excerpts below are plain text taken from the uploaded Word file **under each heading** (not the full document). Use them to match **section intent**, expected questions, and layout cues. Write new analysis from the SOURCE PACK; do not paste lorem or placeholder wording.

${lines.join("\n\n")}
`.trim();
}
