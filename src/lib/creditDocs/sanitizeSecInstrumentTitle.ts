/**
 * Cleans SEC exhibit descriptions and filing titles that often include HTML/CSS fragments,
 * numeric entities (&#160;), inline styles, and partial markup like `Serif; font-size: 10pt">…`.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "…",
  trade: "\u2122",
  copy: "\u00a9",
  reg: "\u00ae",
};

const CSSISH_PROP_FRAGMENTS: RegExp[] = [
  /font-family\s*:\s*[^;]{0,500};?/gi,
  /font-kerning\s*:\s*[^;]{0,200};?/gi,
  /font-weight\s*:\s*[^;]{0,200};?/gi,
  /white-space\s*:\s*[^;]{0,200};?/gi,
  /text-decoration\s*:\s*[^;]{0,300};?/gi,
  /background-color\s*:\s*[^;]{0,300};?/gi,
  /color\s*:\s*[^;]{0,200};?/gi,
  /span\s*style\s*=\s*["'][^"']*["']/gi,
  /style\s*=\s*["'][^"']*["']/gi,
  /class\s*=\s*["'][^"']*["']/gi,
  /\b(?:rgba?|hsla?)\([^)]{0,300}\)/gi,
];

function decodeNumericEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    });
}

function decodeNamedEntities(s: string): string {
  return s.replace(/&([a-z]+);/gi, (full, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? full);
}

function stripTagsRepeated(s: string, max = 10): string {
  let out = s;
  for (let i = 0; i < max; i++) {
    const next = out.replace(/<[^>]+>/g, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripLooseAttributeText(s: string): string {
  return s
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, " ")
    .replace(/\sstyle\s*=\s*'[^']*'/gi, " ")
    .replace(/\sclass\s*=\s*"[^"]*"/gi, " ")
    .replace(/\sclass\s*=\s*'[^']*'/gi, " ");
}

function stripPlaintextCssish(s: string): string {
  let out = s;
  for (const re of CSSISH_PROP_FRAGMENTS) {
    out = out.replace(re, " ");
  }
  return out;
}

/** Drop leading junk like `ht:0.075in;">` that survives tag stripping. */
function stripLeadingCssMeasurementJunk(s: string): string {
  return s
    .replace(/^[^A-Za-z(]{0,120}">\s*/i, " ")
    .replace(/^[\d.]+[a-z%]*;?\s*">\s*/i, " ")
    .replace(/^[a-z-]{1,8}:\s*[\d.]+[a-z%]*;?\s*">\s*/i, " ");
}

/** Strip trailing extension and lightly prettify bare filenames used as exhibit labels. */
function prettifyBareFilenameLabel(s: string): string {
  const m = s.trim().match(/^([a-zA-Z0-9][a-zA-Z0-9_-]*)\.(htm|html|txt|pdf|xsdl)$/i);
  if (!m) return s;
  let base = m[1].replace(/[-_]+/g, " ");
  base = base.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return s.trim();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function stripMarkupAttributeTail(s: string): string {
  let out = s.trim();
  const tryCut = (needle: string) => {
    const idx = out.lastIndexOf(needle);
    if (idx === -1) return;
    const before = out.slice(0, idx);
    const after = out.slice(idx + needle.length).trim();
    if (after.length < 3) return;
    const takeTail =
      before.length === 0 ||
      /\bfont\b|\bserif\b|\bsans\b|arial|helvetica|times|monospace|face|style|width|height|margin|padding|color\s*:|%|\d\s*pt|pt\b/i.test(
        before
      ) ||
      (/[=;:]/ .test(before) && /font|size|width|style|pt|%/.test(before));
    if (takeTail) out = after;
  };
  tryCut('">');
  tryCut("'>");
  return out;
}

/** True when the string still looks like SEC/HTML/CSS extraction junk after cleanup. */
export function isUnusableSanitizedTitle(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  if (t.length < 3) return true;
  if (/^(?:\d+)(?:\.\d+)?$/.test(t)) return true;
  return /(?:style\s*=|font-family|rgba\s*\(|white-space|text-decoration|pre-wrap|font-kerning|font-weight|background-color|color\s*:\s*#|#[0-9a-f]{3,8}\b|0\.\d+in|\d+px\b|calibri|span\b|@font-face|content\s*:|solid;font|underline\s+solid)/i.test(
    t
  );
}

export function sanitizeSecInstrumentTitle(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";

  s = stripTagsRepeated(s);
  s = s.replace(/<\s*br\s*\/?>/gi, " ");
  s = s.replace(/<\/\s*(p|div|tr|td|th|li|h[1-6])\s*>/gi, " ");
  s = stripLooseAttributeText(s);
  s = stripPlaintextCssish(s);

  for (let i = 0; i < 3; i++) {
    s = decodeNamedEntities(s);
    s = decodeNumericEntities(s);
  }

  s = stripLeadingCssMeasurementJunk(s);
  s = stripMarkupAttributeTail(s);

  s = stripPlaintextCssish(s);
  s = stripTagsRepeated(s);

  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/^[\s"'`=<>/]+/, "");
  s = s.replace(/\s+/g, " ").trim();

  if (/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(htm|html|txt)$/i.test(s)) {
    s = prettifyBareFilenameLabel(s);
  }

  if (isUnusableSanitizedTitle(s)) return "";
  return s;
}

export type DebtDocumentTitleFallbacks = {
  exhibitNumber: string;
  filingForm: string;
  filingDate: string;
  directExhibitLink: string;
};

/**
 * Returns a human-readable document title. Uses sanitized exhibit description when usable;
 * otherwise the exhibit filename; otherwise a stable label from exhibit number + filing.
 */
export function resolveDebtDocumentDisplayTitle(rawName: string, fb: DebtDocumentTitleFallbacks): string {
  const primary = sanitizeSecInstrumentTitle(rawName);
  if (primary) return primary.slice(0, 500);

  const filePart = fb.directExhibitLink.split("/").pop() ?? "";
  const fromUrl = sanitizeSecInstrumentTitle(filePart);
  if (fromUrl) return fromUrl.slice(0, 500);

  const ex = fb.exhibitNumber.trim() || "?";
  return `Exhibit ${ex} (${fb.filingForm} · ${fb.filingDate})`;
}
