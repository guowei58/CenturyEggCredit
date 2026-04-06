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

function accNoDashes(acc: string): string {
  return (acc ?? "").replace(/-/g, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`SEC fetch failed (${res.status})`);
  return res.json();
}

export type XbrlFileRef = {
  name: string;
  archiveUrl: string;
  /** "xml" | "xsd" | "zip" */
  kind: "xml" | "xsd" | "zip";
};

/**
 * List XBRL-related artifacts in an EDGAR filing folder (from `index.json`).
 */
export async function listXbrlFilesInFiling(cik: string, accessionNumber: string): Promise<XbrlFileRef[]> {
  const cikNum = parseInt(cik.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) throw new Error("Invalid CIK");
  const accClean = accNoDashes(accessionNumber);
  if (!accClean) throw new Error("Invalid accession number");

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/index.json`;
  const idx = await fetchJson(indexUrl);
  const items = normalizeIndexItems(idx);
  const names = items.map((i) => (i.name ?? "").trim()).filter(Boolean);
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}`;

  const out: XbrlFileRef[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".xbrl.zip")) {
      out.push({ name, archiveUrl: `${base}/${name}`, kind: "zip" });
      continue;
    }
    if (lower.endsWith(".xsd")) {
      out.push({ name, archiveUrl: `${base}/${name}`, kind: "xsd" });
      continue;
    }
    if (lower.endsWith(".xml")) {
      if (lower.includes("index")) continue;
      out.push({ name, archiveUrl: `${base}/${name}`, kind: "xml" });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function fetchSecArchiveFile(url: string): Promise<{ ok: true; body: Buffer } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (!res.ok) return { ok: false, status: res.status };
  const ab = await res.arrayBuffer();
  return { ok: true, body: Buffer.from(ab) };
}
