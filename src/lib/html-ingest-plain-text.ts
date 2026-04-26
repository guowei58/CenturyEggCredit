import * as cheerio from "cheerio";

/**
 * Strip HTML to readable plain text for AI ingest only (saved files stay unchanged).
 * Prefers article → main → body; removes script/style/noscript/template.
 */
export function htmlBufferToPlainTextForIngest(buf: Buffer): string {
  const tryParse = (html: string): string => {
    const $ = cheerio.load(html);
    $("script, style, noscript, template").remove();

    const article = $("article").first();
    const main = $("main").first();
    const body = $("body").first();
    const root = article.length ? article : main.length ? main : body.length ? body : null;

    let text = root ? root.text() : $.root().text();

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  };

  try {
    const utf8 = buf.toString("utf8");
    let out = tryParse(utf8);
    if (out.length < 80) {
      const latin = buf.toString("latin1");
      const alt = tryParse(latin);
      if (alt.length > out.length) out = alt;
    }
    if (!out.trim()) {
      return `[HTML — no extractable text after stripping markup (${buf.length} bytes).]`;
    }
    return out;
  } catch (e) {
    return `[HTML — could not parse for plain text (${e instanceof Error ? e.message : "error"}).]`;
  }
}
