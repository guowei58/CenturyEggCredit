import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  TextRun,
  convertInchesToTwip,
} from "docx";

function splitLines(md: string): string[] {
  return md.replace(/\r\n/g, "\n").split("\n");
}

function cleanInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function normTitleKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function isMarkdownTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  return /^\|[\s\-:|]+\|\s*$/.test(t.replace(/\|\s*$/, "|"));
}

const BODY_FONT = "Times New Roman";
/** Half-points (Word: 22 = 11 pt). */
const SZ_BODY = 22;
const SZ_SMALL = 20;
const SZ_COVER_TITLE = 56;
const SZ_COVER_SUB = 24;
const SZ_H1 = 32;
const SZ_H2 = 28;
const SZ_H3 = 24;

const BODY_SPACING = {
  after: 160,
  line: 276,
  lineRule: LineRuleType.AUTO,
} as const;

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.BOTH,
    spacing: BODY_SPACING,
    children: [
      new TextRun({
        text: cleanInline(text),
        font: BODY_FONT,
        size: SZ_BODY,
      }),
    ],
  });
}

function coverParagraphs(title: string): Paragraph[] {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: cleanInline(title),
          font: BODY_FONT,
          bold: true,
          size: SZ_COVER_TITLE,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: "Credit memorandum",
          font: BODY_FONT,
          size: SZ_COVER_SUB,
          color: "444444",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: dateStr,
          font: BODY_FONT,
          size: SZ_COVER_SUB,
          color: "444444",
        }),
      ],
    }),
  ];
}

function memoFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60 },
        children: [
          new TextRun({
            text: "Confidential — internal use only    ·    Page ",
            font: BODY_FONT,
            size: SZ_SMALL,
            color: "555555",
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: BODY_FONT,
            size: SZ_SMALL,
            color: "555555",
          }),
        ],
      }),
    ],
  });
}

/**
 * Converts memo Markdown to a Word document styled like an institutional credit memo.
 */
export async function memoMarkdownToDocxBuffer(markdown: string, title: string): Promise<Buffer> {
  const lines = splitLines(markdown);
  const children: Paragraph[] = [];

  const titleKey = normTitleKey(title);
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const raw = lines[lineIdx]?.trimEnd() ?? "";
    lineIdx += 1;
    if (!raw.trim()) continue;

    if (/^---+$/.test(raw.trim())) continue;
    if (isMarkdownTableSeparator(raw)) continue;

    if (raw.startsWith("# ") && !children.length) {
      const h1 = normTitleKey(cleanInline(raw.slice(2)));
      if (h1 === titleKey) continue;
    }

    if (raw.startsWith("# ") && cleanInline(raw.slice(2))) {
      children.push(
        new Paragraph({
          text: cleanInline(raw.slice(2)),
          heading: HeadingLevel.HEADING_1,
          keepNext: true,
        })
      );
      continue;
    }

    if (raw.startsWith("## ") && cleanInline(raw.slice(3))) {
      children.push(
        new Paragraph({
          text: cleanInline(raw.slice(3)),
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
        })
      );
      continue;
    }

    if (raw.startsWith("### ") && cleanInline(raw.slice(4))) {
      children.push(
        new Paragraph({
          text: cleanInline(raw.slice(4)),
          heading: HeadingLevel.HEADING_3,
          keepNext: true,
        })
      );
      continue;
    }

    const bulletM = raw.match(/^[-*]\s+(.*)$/);
    if (bulletM) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 100, line: 276, lineRule: LineRuleType.AUTO },
          children: [
            new TextRun({
              text: cleanInline(bulletM[1] ?? ""),
              font: BODY_FONT,
              size: SZ_BODY,
            }),
          ],
        })
      );
      continue;
    }

    const numM = raw.match(/^\d+\.\s+(.*)$/);
    if (numM) {
      children.push(
        new Paragraph({
          spacing: { after: 100, line: 276, lineRule: LineRuleType.AUTO },
          indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.2) },
          children: [
            new TextRun({
              text: cleanInline(numM[1] ?? ""),
              font: BODY_FONT,
              size: SZ_BODY,
            }),
          ],
        })
      );
      continue;
    }

    if (
      raw.includes("|") &&
      raw.replace(/\|/g, "").trim().length > 0 &&
      !isMarkdownTableSeparator(raw)
    ) {
      children.push(
        new Paragraph({
          spacing: { after: 100, line: 264, lineRule: LineRuleType.AUTO },
          shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
          children: [
            new TextRun({
              text: cleanInline(raw),
              font: "Consolas",
              size: SZ_SMALL,
            }),
          ],
        })
      );
      continue;
    }

    children.push(bodyParagraph(raw));
  }

  const letterW = convertInchesToTwip(8.5);
  const letterH = convertInchesToTwip(11);
  const margin = convertInchesToTwip(1);

  const doc = new Document({
    title: cleanInline(title),
    description: "Credit memorandum",
    creator: "Century Egg Credit",
    features: {
      updateFields: true,
    },
    styles: {
      default: {
        document: {
          run: {
            font: BODY_FONT,
            size: SZ_BODY,
          },
          paragraph: {
            alignment: AlignmentType.BOTH,
            spacing: BODY_SPACING,
          },
        },
        heading1: {
          run: { font: BODY_FONT, bold: true, size: SZ_H1 },
          paragraph: {
            spacing: { before: 280, after: 160 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: "222222" },
            },
            keepNext: true,
          },
        },
        heading2: {
          run: { font: BODY_FONT, bold: true, size: SZ_H2 },
          paragraph: {
            spacing: { before: 320, after: 140 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "555555" },
            },
            keepNext: true,
          },
        },
        heading3: {
          run: { font: BODY_FONT, bold: true, italics: true, size: SZ_H3 },
          paragraph: {
            spacing: { before: 220, after: 100 },
            keepNext: true,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: letterW, height: letterH },
            margin: {
              top: margin,
              right: margin,
              bottom: margin,
              left: margin,
              header: convertInchesToTwip(0.5),
              footer: convertInchesToTwip(0.55),
            },
          },
        },
        footers: {
          default: memoFooter(),
        },
        children: [...coverParagraphs(title), ...children],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as unknown as Uint8Array);
}
