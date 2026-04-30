/**
 * Exhibit 21 subsidiary lines: legal name and state/country of incorporation when present.
 * Stored as parallel arrays; legacy rows may embed "Name — Domicile" in the name field only.
 */

const EM_OR_EN_DASH = /\s*[—–]\s+/;

export type SubsidiaryPairedLine = { name: string; domicile: string };

/** Split "Legal Name — Delaware" or hyphen variants; trims noise. */
export function splitSubsidiaryLine(line: string): SubsidiaryPairedLine {
  const raw = line.replace(/\s+/g, " ").trim();
  if (!raw) return { name: "", domicile: "" };
  const parts = raw.split(EM_OR_EN_DASH);
  if (parts.length >= 2) {
    const name = (parts[0] ?? "").trim();
    const domicile = parts
      .slice(1)
      .join(" — ")
      .trim();
    return { name, domicile };
  }
  return { name: raw, domicile: "" };
}

/** Convert hint/list lines to parallel name + domicile arrays (names without embedded dash suffix). */
export function pairedSubsidiariesFromLines(lines: string[]): { names: string[]; domiciles: string[] } {
  const names: string[] = [];
  const domiciles: string[] = [];
  for (const line of lines) {
    const p = splitSubsidiaryLine(line);
    if (p.name.length < 2 && !p.domicile) continue;
    names.push(p.name);
    domiciles.push(p.domicile);
  }
  return { names, domiciles };
}

/**
 * Merge subsidiary lists keyed by legal name (case-insensitive). Domicile fills in when missing.
 */
export function mergeSubsidiaryRows(
  prevNames: string[],
  prevDom: string[],
  incomingNames: string[],
  incomingDom: string[]
): { subsidiaryNames: string[]; subsidiaryDomiciles: string[] } {
  const map = new Map<string, { name: string; dom: string }>();

  const ingest = (rawName: string, rawDom: string) => {
    const p = splitSubsidiaryLine((rawName ?? "").trim());
    const name = (p.name || String(rawName)).replace(/\s+/g, " ").trim();
    let dom = (rawDom ?? "").replace(/\s+/g, " ").trim();
    if (!dom && p.domicile) dom = p.domicile.trim();
    if (name.length < 2) return;
    const key = name.toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { name, dom });
      return;
    }
    map.set(key, { name: prev.name, dom: dom || prev.dom });
  };

  const pl = Math.max(prevNames.length, prevDom.length);
  for (let i = 0; i < pl; i++) ingest(prevNames[i] ?? "", prevDom[i] ?? "");
  const il = Math.max(incomingNames.length, incomingDom.length);
  for (let i = 0; i < il; i++) ingest(incomingNames[i] ?? "", incomingDom[i] ?? "");

  const subsidiaryNames: string[] = [];
  const subsidiaryDomiciles: string[] = [];
  for (const v of map.values()) {
    subsidiaryNames.push(v.name);
    subsidiaryDomiciles.push(v.dom);
  }
  return { subsidiaryNames, subsidiaryDomiciles };
}
