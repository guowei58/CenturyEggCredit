/**
 * Locate Exhibit 21 (subsidiaries) in an SEC filing folder via index.json.
 * The primary 10-K HTML usually does not include Exhibit 21; it is a separate file.
 */

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

type IndexItem = { name?: string; type?: string; size?: string };

function normalizeIndexItems(data: unknown): IndexItem[] {
  if (!data || typeof data !== "object") return [];
  const dir = (data as Record<string, unknown>).directory;
  if (!dir || typeof dir !== "object") return [];
  const item = (dir as Record<string, unknown>).item;
  if (Array.isArray(item)) return item.filter((x) => x && typeof x === "object") as IndexItem[];
  if (item && typeof item === "object") return [item as IndexItem];
  return [];
}

/** Positive signals for Exhibit 21 attachment; avoids matching exhibit321 (Exhibit 3.21). */
function exhibit21FilenameScore(name: string): number {
  const l = name.toLowerCase();
  if (!/\.(htm|html|txt)$/i.test(l)) return 0;
  if (/index-|xslF|\.xsl$/i.test(l)) return 0;

  let score = 0;
  if (/(?:^|[^a-z0-9])ex21(?:[^0-9a-z]|\.(htm|html|txt)$)/i.test(name)) score += 100;
  if (/exhibit(?:[^a-z0-9]+)?21(\d|[^a-z0-9]|\.(htm|html))/i.test(name)) score += 85;
  if (/\bsubsidiar/i.test(l)) score += 55;
  return score;
}

function pickBestExhibit21File(filenames: string[]): string | null {
  const ranked = filenames
    .map((name) => ({ name, score: exhibit21FilenameScore(name) }))
    .filter((x) => x.score >= 55)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.name ?? null;
}

/**
 * Build URL to Exhibit 21 document for a filing, or null if not found in index.
 */
export async function resolveExhibit21DocumentUrl(
  cikPadded: string,
  accessionNumber: string
): Promise<string | null> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return null;
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return null;

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/index.json`;
  let res: Response;
  try {
    res = await fetch(indexUrl, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const items = normalizeIndexItems(data);
  const names = items.map((i) => (i.name ?? "").trim()).filter(Boolean);
  const picked = pickBestExhibit21File(names);
  if (!picked) return null;

  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${picked}`;
}
