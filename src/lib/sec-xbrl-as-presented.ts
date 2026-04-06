/**
 * SEC XBRL as-presented statements from a specific filing.
 *
 * Strategy:
 * - Use SEC Archives `index.json` for the filing folder to locate XBRL instance + linkbases.
 * - Parse presentation linkbase to get row order + hierarchy.
 * - Parse label linkbase for human-readable labels (company-provided).
 * - Parse instance for fact values and contexts to build columns.
 */

import { XMLParser } from "fast-xml-parser";

const USER_AGENT = "CenturyEggCredit research app (mailto:support@example.com)";

export type PresentedFiling = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
};

export type PresentedStatementRow = {
  concept: string; // e.g. us-gaap:Revenues
  label: string;
  depth: number;
  preferredLabelRole: string | null;
  values: Record<string, number | null>; // periodKey -> value
};

export type PresentedStatement = {
  id: string;
  title: string;
  role: string;
  periods: Array<{ key: string; label: string; end: string; start: string | null }>;
  rows: PresentedStatementRow[];
};

export type PresentedStatementsPayload = {
  ok: true;
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  statements: PresentedStatement[];
};

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

function asArr<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseHrefToConcept(href: string): string | null {
  // href like "aapl-20230930x10k.xsd#us-gaap_Revenues"
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

function periodKey(end: string, start: string | null): string {
  return start ? `${start}..${end}` : end;
}

/** Inclusive calendar span; `0` = instant (no start). */
function periodDurationDays(p: { start: string | null; end: string }): number {
  if (p.start == null || p.start === "") return 0;
  const t0 = Date.parse(`${p.start}T12:00:00Z`);
  const t1 = Date.parse(`${p.end}T12:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  const days = Math.round((t1 - t0) / 86400000) + 1;
  return days > 0 ? days : 0;
}

/** Display order: latest period first (by `end`), then earlier; tie-break by interval start (later start first). */
function sortPeriodsLatestFirst<T extends { end: string; start: string | null }>(periods: T[]): T[] {
  return [...periods].sort((a, b) => {
    if (b.end !== a.end) return b.end.localeCompare(a.end);
    const aStart = a.start ?? a.end;
    const bStart = b.start ?? b.end;
    return bStart.localeCompare(aStart);
  });
}

/** IS / CF / equity rollforwards are duration statements; omit 1-day & instant columns when FY columns exist. */
const MIN_DURATION_DAYS_FOR_RANGE_STATEMENT = 28;

function filterPeriodEntriesForStatementTitle<T extends { start: string | null; end: string; key: string }>(
  entries: Array<T & { score: number }>,
  statementTitle: string
): Array<T & { score: number }> {
  const rangeHeavy =
    statementTitle === "Income Statement" ||
    statementTitle === "Cash Flow" ||
    statementTitle === "Equity";
  if (!rangeHeavy) return entries;

  const multiDay = entries.filter((e) => periodDurationDays(e) >= MIN_DURATION_DAYS_FOR_RANGE_STATEMENT);
  if (multiDay.length >= 3) return multiDay;
  return entries;
}

/** Fewer explicit XBRL dimensions → closer to consolidated statement totals (not a segment slice). */
function explicitMemberCount(ctxEl: any): number {
  const ent = ctxEl?.["xbrli:entity"] ?? ctxEl?.["entity"];
  if (!ent || typeof ent !== "object") return 0;
  const seg = ent["xbrli:segment"] ?? ent["segment"];
  if (!seg) return 0;
  const em = seg["xbrldi:explicitMember"] ?? seg["explicitMember"];
  return asArr(em).length;
}

const MAX_PERIOD_COLUMNS = 5;

function isNilFact(item: any): boolean {
  const nilRaw = item?.["@_xsi:nil"] ?? item?.["@_nil"];
  return nilRaw === true || nilRaw === "true" || nilRaw === 1 || nilRaw === "1";
}

/** One of three primary financials, or null = skip (parenthetical, disclosure, equity, OCI, etc.). */
function primaryStatementKind(role: string): "is" | "bs" | "cf" | null {
  const u = role.toLowerCase();
  const c = u.replace(/[\s_-]/g, "");
  if (u.includes("parenthetical")) return null;
  if (/\/role\/disclosure/i.test(role) || c.includes("disclosureoperating") || c.includes("disclosurestock") || c.includes("disclosuredebt")) return null;
  if (c.includes("documentdocument") || c.includes("documentandentity")) return null;
  if (/\/ecd\//i.test(role) || c.includes("insidertrading")) return null;
  if (c.includes("comprehensive") && (c.includes("income") || c.includes("earnings") || c.includes("loss"))) return null;
  if (
    c.includes("statementofequity") ||
    c.includes("statementsofequity") ||
    c.includes("stockholdersequity") ||
    c.includes("shareholdersequity")
  ) {
    return null;
  }

  if (c.includes("cashflow") || (c.includes("cash") && c.includes("flow"))) return "cf";
  if (c.includes("balancesheet") || c.includes("financialposition") || (c.includes("balance") && c.includes("sheet"))) return "bs";
  if (
    c.includes("incomestatement") ||
    c.includes("statementsofoperations") ||
    c.includes("statementofoperations") ||
    (c.includes("statement") && c.includes("operations")) ||
    (c.includes("statement") && c.includes("income")) ||
    (c.includes("statement") && c.includes("earnings")) ||
    (c.includes("profit") && c.includes("loss"))
  ) {
    return "is";
  }
  return null;
}

function displayTitleForPrimaryKind(kind: "is" | "bs" | "cf"): string {
  if (kind === "is") return "Income Statement";
  if (kind === "bs") return "Balance Sheet";
  return "Cash Flow";
}

function gridNonNullCount(rows: PresentedStatementRow[], periodKeys: string[]): number {
  let n = 0;
  for (const row of rows) {
    for (const pk of periodKeys) {
      const v = row.values[pk];
      if (v !== null && Number.isFinite(v)) n++;
    }
  }
  return n;
}

function likelyStatementRole(role: string): boolean {
  const r = role.toLowerCase();
  if (!r.includes("role")) return true;
  return (
    r.includes("statement") ||
    r.includes("balancesheet") ||
    r.includes("financialposition") ||
    r.includes("income") ||
    r.includes("operations") ||
    r.includes("cashflow") ||
    r.includes("equity")
  );
}

/**
 * SEC XBRL uses many character/entity expansions. fast-xml-parser v5 only applies limits under
 * `processEntities` (object); top-level maxTotalExpansions is ignored when processEntities is `true`.
 */
const parser = new XMLParser({
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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (!res.ok) throw new Error(`SEC fetch failed (${res.status})`);
  return res.text();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`SEC fetch failed (${res.status})`);
  return res.json();
}

function findBestXbrlFiles(names: string[]): { instance: string | null; pre: string | null; lab: string | null } {
  const lower = names.map((n) => n.toLowerCase());
  const pick = (re: RegExp) => {
    const idx = lower.findIndex((n) => re.test(n));
    return idx >= 0 ? names[idx]! : null;
  };
  // Instance: prefer *_htm.xml or *.xml that isn't linkbase
  const pre = pick(/_pre\.xml$/i);
  const lab = pick(/_lab\.xml$/i);
  let instance = pick(/_htm\.xml$/i);
  if (!instance) {
    const idx = lower.findIndex((n) => n.endsWith(".xml") && !n.endsWith("_pre.xml") && !n.endsWith("_lab.xml") && !n.endsWith("_cal.xml"));
    instance = idx >= 0 ? names[idx]! : null;
  }
  return { instance, pre, lab };
}

type PreParse = {
  roles: Array<{ role: string; locs: Record<string, string>; arcs: Array<{ from: string; to: string; order: number; preferredLabel?: string | null }> }>;
};

function parsePresentation(preXml: string): PreParse {
  const o = parser.parse(preXml) as any;
  const linkbase = o["link:linkbase"] ?? o["linkbase"] ?? o;
  /** Default linkbase NS → unprefixed `presentationLink` / `loc` (common on SEC filings). */
  const pres = asArr(linkbase["link:presentationLink"] ?? linkbase["presentationLink"]);
  const roles: PreParse["roles"] = [];
  for (const pl of pres) {
    const role = pl?.["@_xlink:role"] ?? pl?.["@_role"] ?? "";
    if (!role || (typeof role === "string" && !likelyStatementRole(role))) continue;
    const locs: Record<string, string> = {};
    for (const loc of asArr(pl["link:loc"] ?? pl["loc"])) {
      const label = loc?.["@_xlink:label"];
      const href = loc?.["@_xlink:href"];
      if (typeof label !== "string" || typeof href !== "string") continue;
      const concept = parseHrefToConcept(href);
      if (!concept) continue;
      locs[label] = concept;
    }
    const arcs: Array<{ from: string; to: string; order: number; preferredLabel?: string | null }> = [];
    for (const arc of asArr(pl["link:presentationArc"] ?? pl["presentationArc"])) {
      const from = arc?.["@_xlink:from"];
      const to = arc?.["@_xlink:to"];
      const orderRaw = arc?.["@_order"];
      const pref = arc?.["@_preferredLabel"];
      const order = typeof orderRaw === "string" ? parseFloat(orderRaw) : typeof orderRaw === "number" ? orderRaw : 0;
      if (typeof from !== "string" || typeof to !== "string") continue;
      arcs.push({ from, to, order: Number.isFinite(order) ? order : 0, preferredLabel: typeof pref === "string" ? pref : null });
    }
    roles.push({ role, locs, arcs });
  }
  return { roles };
}

function parseLabels(labXml: string): Map<string, Map<string, string>> {
  // concept -> role -> label
  const o = parser.parse(labXml) as any;
  const linkbase = o["link:linkbase"] ?? o["linkbase"] ?? o;
  const links = asArr(linkbase["link:labelLink"] ?? linkbase["labelLink"]);
  const labelByLinkLabel = new Map<string, { role: string; text: string }>();
  const conceptByLocLabel = new Map<string, string>();
  const out = new Map<string, Map<string, string>>();

  for (const ll of links) {
    for (const loc of asArr(ll["link:loc"] ?? ll["loc"])) {
      const label = loc?.["@_xlink:label"];
      const href = loc?.["@_xlink:href"];
      if (typeof label !== "string" || typeof href !== "string") continue;
      const concept = parseHrefToConcept(href);
      if (!concept) continue;
      conceptByLocLabel.set(label, concept);
    }
    for (const lab of asArr(ll["link:label"] ?? ll["label"])) {
      const label = lab?.["@_xlink:label"];
      const role = lab?.["@_xlink:role"] ?? "";
      const text = typeof lab?.["#text"] === "string" ? lab["#text"] : typeof lab === "string" ? lab : "";
      if (typeof label !== "string" || !text) continue;
      labelByLinkLabel.set(label, { role: typeof role === "string" ? role : "", text: String(text).trim() });
    }
    for (const arc of asArr(ll["link:labelArc"] ?? ll["labelArc"])) {
      const from = arc?.["@_xlink:from"];
      const to = arc?.["@_xlink:to"];
      if (typeof from !== "string" || typeof to !== "string") continue;
      const concept = conceptByLocLabel.get(from);
      const lab = labelByLinkLabel.get(to);
      if (!concept || !lab?.text) continue;
      const m = out.get(concept) ?? new Map<string, string>();
      if (!m.has(lab.role)) m.set(lab.role, lab.text);
      out.set(concept, m);
    }
  }

  return out;
}

type InstanceParse = {
  contextPeriod: Map<string, { end: string; start: string | null }>;
  /** Count of xbrldi:explicitMember in context (0 = entity-wide, preferred for primary columns). */
  contextDimCount: Map<string, number>;
  unitMeasure: Map<string, string>;
  facts: Map<string, Array<{ contextRef: string; unitRef: string | null; value: number }>>;
};

function parseInstance(instanceXml: string, conceptSet: Set<string>): InstanceParse {
  const o = parser.parse(instanceXml) as any;
  const x = o["xbrli:xbrl"] ?? o["xbrl"] ?? o;

  const contextPeriod = new Map<string, { end: string; start: string | null }>();
  const contextDimCount = new Map<string, number>();
  for (const c of asArr(x["xbrli:context"] ?? x["context"])) {
    const id = c?.["@_id"];
    if (typeof id !== "string") continue;
    contextDimCount.set(id, explicitMemberCount(c));
    const period = c?.["xbrli:period"] ?? c?.["period"];
    const instant = period?.["xbrli:instant"] ?? period?.["instant"];
    const start = period?.["xbrli:startDate"] ?? period?.["startDate"];
    const end = period?.["xbrli:endDate"] ?? period?.["endDate"];
    const instantStr = typeof instant === "string" ? instant.trim() : typeof instant === "number" ? String(instant) : "";
    const endStr = typeof end === "string" ? end.trim() : typeof end === "number" ? String(end) : "";
    const startStr = typeof start === "string" ? start.trim() : typeof start === "number" ? String(start) : null;
    if (instantStr) {
      contextPeriod.set(id, { end: instantStr, start: null });
    } else if (endStr) {
      contextPeriod.set(id, { end: endStr, start: startStr });
    }
  }

  const unitMeasure = new Map<string, string>();
  for (const u of asArr(x["xbrli:unit"] ?? x["unit"])) {
    const id = u?.["@_id"];
    const measure = u?.["xbrli:measure"] ?? u?.["measure"];
    if (typeof id !== "string") continue;
    if (typeof measure === "string") unitMeasure.set(id, measure.trim());
  }

  const facts = new Map<string, Array<{ contextRef: string; unitRef: string | null; value: number }>>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (conceptSet.has(k)) {
        for (const item of asArr(v)) {
          if (isNilFact(item)) continue;
          const ctx = item?.["@_contextRef"];
          const unit = typeof item?.["@_unitRef"] === "string" ? item["@_unitRef"] : null;
          const raw = item?.["#text"];
          const num = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw.replace(/,/g, "")) : NaN;
          if (typeof ctx !== "string" || !Number.isFinite(num)) continue;
          const arr = facts.get(k) ?? [];
          arr.push({ contextRef: ctx, unitRef: unit, value: num });
          facts.set(k, arr);
        }
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(x);

  return { contextPeriod, contextDimCount, unitMeasure, facts };
}

function scorePeriodForStatement(
  key: string,
  nodes: Array<{ concept: string; depth: number; preferredLabelRole: string | null }>,
  inst: InstanceParse
): number {
  let score = 0;
  for (const n of nodes) {
    const factList = inst.facts.get(n.concept) ?? [];
    for (const f of factList) {
      const p = inst.contextPeriod.get(f.contextRef);
      if (!p?.end) continue;
      if (periodKey(p.end, p.start) !== key) continue;
      const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
      if (dim === 0) score += 3;
      else score += 1;
    }
  }
  return score;
}

function pickValueForPeriod(
  candidates: Array<{ value: number; measure: string | null; dim: number }>
): number | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const aud = a.measure?.toLowerCase().includes("usd") ? 0 : 1;
    const bud = b.measure?.toLowerCase().includes("usd") ? 0 : 1;
    if (aud !== bud) return aud - bud;
    if (a.dim !== b.dim) return a.dim - b.dim;
    return 0;
  });
  return sorted[0]!.value;
}

function buildTree(role: PreParse["roles"][number], labels: Map<string, Map<string, string>>) {
  const children = new Map<string, Array<{ to: string; order: number; preferredLabel: string | null }>>();
  const incoming = new Set<string>();
  for (const a of role.arcs) {
    const arr = children.get(a.from) ?? [];
    arr.push({ to: a.to, order: a.order, preferredLabel: a.preferredLabel ?? null });
    children.set(a.from, arr);
    incoming.add(a.to);
  }
  for (const arr of Array.from(children.values())) arr.sort((a, b) => a.order - b.order);

  const roots = Array.from(Object.keys(role.locs)).filter((lbl) => !incoming.has(lbl));

  const nodes: Array<{ concept: string; depth: number; preferredLabelRole: string | null }> = [];
  const seen = new Set<string>();

  const dfs = (locLabel: string, depth: number, prefRole: string | null) => {
    const concept = role.locs[locLabel];
    if (!concept) return;
    const key = `${locLabel}::${depth}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push({ concept, depth, preferredLabelRole: prefRole });
    for (const ch of children.get(locLabel) ?? []) {
      dfs(ch.to, depth + 1, ch.preferredLabel);
    }
  };

  for (const r of roots) dfs(r, 0, null);

  // pick labels
  const labelFor = (concept: string, prefRole: string | null) => {
    const m = labels.get(concept);
    if (!m) return concept;
    if (prefRole && m.get(prefRole)) return m.get(prefRole)!;
    const std = "http://www.xbrl.org/2003/role/label";
    return m.get(std) ?? Array.from(m.values())[0] ?? concept;
  };

  return nodes.map((n) => ({ ...n, label: labelFor(n.concept, n.preferredLabelRole) }));
}

export async function fetchAsPresentedStatements(params: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
}): Promise<PresentedStatementsPayload> {
  const cikNum = parseInt(params.cik.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) throw new Error("Invalid CIK");

  const acc = params.accessionNumber;
  const accClean = accNoDashes(acc);
  if (!accClean) throw new Error("Invalid accession number");

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}/index.json`;
  const idx = await fetchJson(indexUrl);
  const items = normalizeIndexItems(idx);
  const names = items.map((i) => (i.name ?? "").trim()).filter(Boolean);

  const picked = findBestXbrlFiles(names);
  if (!picked.pre || !picked.lab || !picked.instance) {
    throw new Error("XBRL linkbase files not found for this filing.");
  }

  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accClean}`;
  const preXml = await fetchText(`${base}/${picked.pre}`);
  const labXml = await fetchText(`${base}/${picked.lab}`);
  const instanceXml = await fetchText(`${base}/${picked.instance}`);

  const pres = parsePresentation(preXml);
  const labs = parseLabels(labXml);

  // Build concept set used by any statement role.
  const conceptSet = new Set<string>();
  for (const r of pres.roles) {
    for (const locLabel of Object.keys(r.locs)) conceptSet.add(r.locs[locLabel]!);
  }

  const inst = parseInstance(instanceXml, conceptSet);

  type PrimaryCandidate = {
    kind: "is" | "bs" | "cf";
    density: number;
    rowsWithValues: number;
    statement: PresentedStatement;
  };
  const primaryCandidates: PrimaryCandidate[] = [];

  for (const r of pres.roles) {
    const kind = primaryStatementKind(r.role);
    if (!kind) continue;

    const nodes = buildTree(r, labs);
    const statementTitle = displayTitleForPrimaryKind(kind);

    // Collect periods from facts used in this statement.
    const periodMap = new Map<string, { end: string; start: string | null }>();
    for (const n of nodes) {
      const facts = inst.facts.get(n.concept) ?? [];
      for (const f of facts) {
        const p = inst.contextPeriod.get(f.contextRef);
        if (!p?.end) continue;
        const k = periodKey(p.end, p.start);
        periodMap.set(k, p);
      }
    }

    const scored = Array.from(periodMap.entries()).map(([k, p]) => ({
      key: k,
      ...p,
      score: scorePeriodForStatement(k, nodes, inst),
    }));
    const filtered = filterPeriodEntriesForStatementTitle(scored, statementTitle);

    const chosenPeriods = filtered
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const bd = periodDurationDays(b);
        const ad = periodDurationDays(a);
        if (bd !== ad) return bd - ad;
        if (b.end !== a.end) return b.end.localeCompare(a.end);
        return (a.start ?? "").localeCompare(b.start ?? "");
      })
      .slice(0, MAX_PERIOD_COLUMNS);

    const periodsSorted = sortPeriodsLatestFirst(chosenPeriods);

    const rows: PresentedStatementRow[] = nodes.map((n) => {
      const facts = inst.facts.get(n.concept) ?? [];
      const out: Record<string, number | null> = {};
      for (const p of periodsSorted) out[p.key] = null;

      const byPeriod = new Map<string, Array<{ value: number; measure: string | null; dim: number }>>();
      for (const f of facts) {
        const p = inst.contextPeriod.get(f.contextRef);
        if (!p?.end) continue;
        const k = periodKey(p.end, p.start);
        if (!Object.prototype.hasOwnProperty.call(out, k)) continue;
        const measure = f.unitRef ? inst.unitMeasure.get(f.unitRef) ?? null : null;
        const dim = inst.contextDimCount.get(f.contextRef) ?? 99;
        const arr = byPeriod.get(k) ?? [];
        arr.push({ value: f.value, measure, dim });
        byPeriod.set(k, arr);
      }
      for (const [k, arr] of Array.from(byPeriod.entries())) {
        out[k] = pickValueForPeriod(arr);
      }

      return {
        concept: n.concept,
        label: n.label,
        depth: n.depth,
        preferredLabelRole: n.preferredLabelRole,
        values: out,
      };
    });

    if (rows.length === 0 || periodsSorted.length === 0) continue;

    const periodKeys = periodsSorted.map((p) => p.key);
    const density = gridNonNullCount(rows, periodKeys);
    const rowsWithValues = rows.filter((row) => periodKeys.some((pk) => row.values[pk] !== null)).length;

    const title = statementTitle;
    const statement: PresentedStatement = {
      id: `primary-${kind}`,
      title,
      role: r.role,
      periods: periodsSorted.map((p) => ({
        key: p.key,
        label: p.start ? `${p.start} → ${p.end}` : p.end,
        end: p.end,
        start: p.start,
      })),
      rows,
    };
    primaryCandidates.push({ kind, density, rowsWithValues, statement });
  }

  const bestByKind = new Map<"is" | "bs" | "cf", PrimaryCandidate>();
  for (const c of primaryCandidates) {
    const prev = bestByKind.get(c.kind);
    if (
      !prev ||
      c.density > prev.density ||
      (c.density === prev.density && c.rowsWithValues > prev.rowsWithValues)
    ) {
      bestByKind.set(c.kind, c);
    }
  }

  const statements: PresentedStatement[] = (["is", "bs", "cf"] as const)
    .map((k) => bestByKind.get(k)?.statement)
    .filter((s): s is PresentedStatement => Boolean(s));

  return {
    ok: true,
    cik: params.cik,
    accessionNumber: params.accessionNumber,
    form: params.form,
    filingDate: params.filingDate,
    statements,
  };
}

