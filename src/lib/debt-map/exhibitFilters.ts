import { DEBT_EXHIBIT_KEYWORDS } from "@/lib/debt-map/constants";

const EX_EXHIBIT = /^ex-?(\d+(?:\.\d+)?)/i;

/**
 * True if filename or description looks like a prioritized exhibit number (EX-4.x, EX-10.x, EX-21, …).
 */
export function exhibitNumberMatchesPriority(filename: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  const m = base.match(EX_EXHIBIT);
  if (!m) return false;
  const n = m[1];
  if (n === "4" || n.startsWith("4.")) return true;
  if (n === "10" || n.startsWith("10.")) return true;
  if (["21", "22", "25"].includes(n)) return true;
  return false;
}

export function exhibitMatchesDebtKeywords(filename: string, description?: string): boolean {
  const blob = `${filename} ${description ?? ""}`.toLowerCase();
  return DEBT_EXHIBIT_KEYWORDS.some((k) => blob.includes(k.toLowerCase()));
}

export function shouldIncludeExhibitFile(
  filename: string,
  primaryDoc: string,
  opts: { includeExhibit21: boolean; includeExhibit22: boolean }
): boolean {
  const lower = filename.toLowerCase();
  if (filename === primaryDoc) return false;
  if (/index-|xslf|\.xsl$/i.test(lower)) return false;

  const ex21 = /(?:^|[^a-z0-9])ex(?:hibit)?[^a-z0-9]*21(?:[^0-9a-z]|\.(htm|html|txt|pdf)$)/i.test(filename);
  const ex22 = /(?:^|[^a-z0-9])ex(?:hibit)?[^a-z0-9]*22(?:[^0-9a-z]|\.(htm|html|txt|pdf)$)/i.test(filename);
  if (ex21 && !opts.includeExhibit21) return false;
  if (ex22 && !opts.includeExhibit22) return false;

  if (exhibitNumberMatchesPriority(filename)) return true;
  if (exhibitMatchesDebtKeywords(filename)) return true;
  return false;
}
