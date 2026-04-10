import { XMLParser } from "fast-xml-parser";

export type CalculationArcRow = {
  role: string;
  parentConcept: string;
  childConcept: string;
  weight: number;
  order: number;
};

function asArr<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseHrefToConcept(href: string): string | null {
  const hash = href.indexOf("#");
  if (hash < 0) return null;
  const frag = href.slice(hash + 1);
  const u = frag.indexOf("_");
  if (u < 1) return null;
  const prefix = frag.slice(0, u);
  const name = frag.slice(u + 1);
  if (!prefix || !name) return null;
  return `${prefix}:${name}`;
}

const calcParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  textNodeName: "#text",
  processEntities: {
    enabled: true,
    maxTotalExpansions: 2_000_000,
    maxEntityCount: 50_000,
    maxExpandedLength: 50_000_000,
  },
});

/**
 * Parses XBRL calculation linkbase (`*_cal.xml`). Used to (1) widen the instance fact concept set and
 * (2) validate rollups against presentation values.
 */
export function parseCalculationLinkbase(calXml: string): CalculationArcRow[] {
  const o = calcParser.parse(calXml) as Record<string, unknown>;
  const linkbase = (o["link:linkbase"] ?? o["linkbase"] ?? o) as Record<string, unknown>;
  const links = asArr(linkbase["link:calculationLink"] ?? linkbase["calculationLink"]);
  const out: CalculationArcRow[] = [];

  for (const cl of links) {
    const el = cl as Record<string, unknown>;
    const role = String(el["@_xlink:role"] ?? el["@_role"] ?? "");
    const locs = new Map<string, string>();
    for (const loc of asArr(el["link:loc"] ?? el["loc"])) {
      const le = loc as Record<string, unknown>;
      const label = le["@_xlink:label"];
      const href = le["@_xlink:href"];
      if (typeof label !== "string" || typeof href !== "string") continue;
      const c = parseHrefToConcept(href);
      if (c) locs.set(label, c);
    }
    for (const arc of asArr(el["link:calculationArc"] ?? el["calculationArc"])) {
      const ae = arc as Record<string, unknown>;
      const from = ae["@_xlink:from"];
      const to = ae["@_xlink:to"];
      const wRaw = ae["@_weight"];
      const orderRaw = ae["@_order"];
      if (typeof from !== "string" || typeof to !== "string") continue;
      const parentConcept = locs.get(from);
      const childConcept = locs.get(to);
      if (!parentConcept || !childConcept) continue;
      const weight =
        typeof wRaw === "number" ? wRaw : typeof wRaw === "string" ? parseFloat(wRaw) : 1;
      const order =
        typeof orderRaw === "number" ? orderRaw : typeof orderRaw === "string" ? parseFloat(orderRaw) : 0;
      out.push({
        role,
        parentConcept,
        childConcept,
        weight: Number.isFinite(weight) ? weight : 1,
        order: Number.isFinite(order) ? order : 0,
      });
    }
  }
  return out;
}

export function conceptsReferencedInCalculationArcs(arcs: CalculationArcRow[]): Set<string> {
  const s = new Set<string>();
  for (const a of arcs) {
    s.add(a.parentConcept);
    s.add(a.childConcept);
  }
  return s;
}
