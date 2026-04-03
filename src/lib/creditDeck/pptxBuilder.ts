import PptxGenJS from "pptxgenjs";

export type DeckSlideSpec = { title: string; bullets: string[] };

/**
 * Build a first-draft credit deck: title slide, then one slide per outline section
 * with bullets on the left and a reserved area for charts on the right.
 */
export async function buildCreditDeckPptxBuffer(params: {
  deckTitle: string;
  ticker: string;
  slides: DeckSlideSpec[];
}): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Century Egg Credit";
  pptx.title = params.deckTitle;

  const titleSlide = pptx.addSlide();
  titleSlide.addText(params.deckTitle, {
    x: 0.5,
    y: 2.1,
    w: 12.3,
    fontSize: 28,
    bold: true,
    color: "1a1a1a",
  });
  titleSlide.addText(`${params.ticker} — Credit deck (first draft — add charts in shaded areas)`, {
    x: 0.5,
    y: 3.25,
    w: 12.3,
    fontSize: 13,
    color: "555555",
  });

  for (const slideSpec of params.slides) {
    const slide = pptx.addSlide();

    slide.addText(slideSpec.title, {
      x: 0.4,
      y: 0.35,
      w: 12.5,
      fontSize: 18,
      bold: true,
      color: "1a1a1a",
    });

    const bullets = slideSpec.bullets.filter((b) => b.trim());
    const body =
      bullets.length > 0
        ? bullets.map((text) => ({
            text,
            options: { bullet: { type: "bullet" as const }, fontSize: 11, breakLine: true },
          }))
        : [
            {
              text: "[need additional information]",
              options: { bullet: { type: "bullet" as const }, fontSize: 11, breakLine: true },
            },
          ];

    slide.addText(body as PptxGenJS.TextProps[], {
      x: 0.4,
      y: 1.0,
      w: 6.35,
      h: 4.2,
      valign: "top",
      fontSize: 11,
    });

    slide.addShape(pptx.ShapeType.rect, {
      x: 6.95,
      y: 1.0,
      w: 5.95,
      h: 4.2,
      fill: { color: "F3F4F6" },
      line: { color: "C5C5C5", width: 1, dashType: "dash" },
    });
    slide.addText("Chart / graph area\n(paste exhibit here)", {
      x: 6.95,
      y: 2.65,
      w: 5.95,
      h: 1.5,
      fontSize: 11,
      color: "888888",
      align: "center",
      valign: "middle",
    });
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as ArrayBuffer);
}
