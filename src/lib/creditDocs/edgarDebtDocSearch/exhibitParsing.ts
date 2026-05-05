/**
 * Step 6 — Parse exhibit index cues from filing HTML (supplements directory index.json).
 */

export interface ParsedExhibitIndexRow {
  exhibitNumber: string;
  description: string;
  filename?: string;
}

export function parseExhibitIndex(filingHtml: string): ParsedExhibitIndexRow[] {
  const rows: ParsedExhibitIndexRow[] = [];
  const cleaned = filingHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");

  const linkRe = /<a[^>]+href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(cleaned)) !== null) {
    const href = (m[1] ?? "").trim();
    const inner = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
    if (!/\.(htm|html|txt|pdf|xml)$/i.test(href)) continue;

    const ctxStart = Math.max(0, m.index - 380);
    const ctxRaw = cleaned.slice(ctxStart, Math.min(cleaned.length, m.index + m[0].length + 40));
    const ctx = ctxRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    const exM = ctx.match(/(?:Exhibit|EX-)\s*([\d.]+)/i);
    const exhibitNumber = exM?.[1]?.trim() ?? "";
    const blob = `${inner} ${ctx}`;
    if (
      !exhibitNumber &&
      !/\bexhibit\b/i.test(blob) &&
      !/\b(?:indenture|credit|guarantee|guaranty|note|loan|collateral|intercreditor)\b/i.test(blob)
    )
      continue;

    const filename = href.split("/").pop()?.trim();
    rows.push({
      exhibitNumber: exhibitNumber || "?",
      description: inner.slice(0, 280) || ctx.slice(-220).trim(),
      filename,
    });
  }

  return rows;
}

export function exhibitContextSnippet(html: string, filename: string): string {
  const i = html.indexOf(filename);
  if (i < 0) return "";
  const slice = html.slice(Math.max(0, i - 480), Math.min(html.length, i + filename.length + 100));
  return slice.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 360);
}
