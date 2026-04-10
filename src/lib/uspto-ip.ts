/**
 * USPTO-facing IP lookups (server-only).
 * - ODP: https://data.uspto.gov/apis/getting-started (USPTO_API_KEY; header X-API-Key or x-api-key)
 * - TSDR: https://developer.uspto.gov (USPTO_TSDR_API_KEY, USPTO-API-KEY header)
 * - PatentsView: optional assignee/granted-patent enrichment (USPTO_PATENTSVIEW_API_KEY)
 */

const USER_AGENT = "CenturyEggCredit/1.0 (credit-research; +https://github.com/)";

export type OdpPatentHit = {
  applicationNumberText: string | null;
  inventionTitle: string | null;
  filingDate: string | null;
  patentNumber: string | null;
  applicationStatusCategory: string | null;
  assigneeEntityName: string | null;
  inventorNames: string[];
};

export type PatentsViewPatentHit = {
  patentId: string | null;
  title: string | null;
  patentDate: string | null;
  assignees: string[];
};

export type PatentsViewAssigneeHit = {
  assigneeId: string | null;
  organization: string | null;
  totalPatents: number | null;
};

export type TsdrTrademarkSummary = {
  serialNumber: string | null;
  registrationNumber: string | null;
  mark: string | null;
  status: string | null;
  statusDate: string | null;
  filingDate: string | null;
  registrationDate: string | null;
  owner: string | null;
  goodsAndServices: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickStr(obj: Record<string, unknown> | undefined, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/** ODP returns hits in `patentFileWrapperDataBag` with nested `applicationMetaData` (not the legacy flat `patentFileWrapperSearchResults`). */
function normalizeOdpSearchRow(row: unknown): OdpPatentHit {
  if (!isRecord(row)) {
    return {
      applicationNumberText: null,
      inventionTitle: null,
      filingDate: null,
      patentNumber: null,
      applicationStatusCategory: null,
      assigneeEntityName: null,
      inventorNames: [],
    };
  }

  const meta = isRecord(row.applicationMetaData) ? row.applicationMetaData : undefined;

  let inventorNames: string[] = [];
  const flatInv = row.inventorNameArrayText;
  if (Array.isArray(flatInv)) {
    inventorNames = flatInv.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } else {
    const invBag = meta?.inventorBag;
    if (Array.isArray(invBag)) {
      inventorNames = invBag
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item)) {
            const byName = pickStr(item, "inventorNameText");
            if (byName) return byName;
            const full = [pickStr(item, "inventorFirstName"), pickStr(item, "inventorLastName")]
              .filter(Boolean)
              .join(" ")
              .trim();
            return full || null;
          }
          return null;
        })
        .filter((x): x is string => Boolean(x && x.trim()));
    }
  }

  let assigneeEntityName =
    pickStr(meta, "assigneeEntityName") ??
    pickStr(row, "assigneeEntityName") ??
    null;
  if (!assigneeEntityName) {
    const ab = meta?.assigneeBag ?? meta?.assigneeEntityBag;
    if (Array.isArray(ab) && ab[0] && isRecord(ab[0])) {
      const a0 = ab[0];
      assigneeEntityName =
        pickStr(a0, "assigneeEntityName") ?? pickStr(a0, "assigneeName") ?? pickStr(a0, "organizationStandardName");
    }
  }

  return {
    applicationNumberText: pickStr(row, "applicationNumberText"),
    inventionTitle: pickStr(meta, "inventionTitle") ?? pickStr(row, "inventionTitle"),
    filingDate: pickStr(meta, "filingDate") ?? pickStr(row, "filingDate"),
    patentNumber: pickStr(meta, "patentNumber") ?? pickStr(row, "patentNumber"),
    applicationStatusCategory:
      pickStr(meta, "applicationStatusCategory") ??
      pickStr(meta, "applicationStatusDescriptionText") ??
      pickStr(row, "applicationStatusCategory"),
    assigneeEntityName,
    inventorNames,
  };
}

function extractOdpSearchRows(data: Record<string, unknown>): unknown[] {
  const bag = data.patentFileWrapperDataBag ?? data.patentFileWrapperSearchResults;
  if (Array.isArray(bag)) return bag;
  return [];
}

function extractOdpTotalCount(data: Record<string, unknown>, hitsLen: number): number {
  if (typeof data.count === "number") return data.count;
  if (typeof data.totalNumFound === "number") return data.totalNumFound;
  return hitsLen;
}

function stripPatentNumberForUrl(num: string): string {
  return num.replace(/[^\d]/g, "");
}

/**
 * ODP patent search uses Lucene-style syntax. Plain company names hit every token (INC, CORP, LLC match broadly).
 * Wrap unqualified text in double quotes for a phrase query; leave field queries and already-quoted input unchanged.
 */
export function formatOdpPatentQueryString(raw: string): string {
  const q = raw.trim();
  if (!q) return q;
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) return q;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(q)) return q;
  const inner = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${inner}"`;
}

/**
 * PatentsView `_text_phrase` expects plain text, not Lucene-style `"..."` wrappers.
 */
export function unwrapOdpStylePhrase(raw: string): string {
  const q = raw.trim();
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) {
    return q.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return q;
}

/** Google Patents URL when a grant number exists. */
export function patentNumberToGooglePatentsUrl(patentNumber: string | null | undefined): string | null {
  if (!patentNumber?.trim()) return null;
  const n = stripPatentNumberForUrl(patentNumber);
  if (!n) return null;
  return `https://patents.google.com/patent/US${n}`;
}

export async function searchOdpPatentApplications(
  apiKey: string,
  query: string,
  offset: number,
  limit: number
): Promise<{ total: number; hits: OdpPatentHit[] }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  // Official ODP path (see PEDS→ODP mapping): /patent/applications/search — not patent-applications.
  const res = await fetch("https://api.uspto.gov/api/v1/patent/applications/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      q: query,
      pagination: { offset: Math.max(0, offset), limit: capped },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`USPTO ODP patent search failed (${res.status}): ${t.slice(0, 280)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const rows = extractOdpSearchRows(data);
  const hits: OdpPatentHit[] = rows.map(normalizeOdpSearchRow);

  return { total: extractOdpTotalCount(data, hits.length), hits };
}

export async function searchPatentsViewAssignees(
  apiKey: string,
  organization: string,
  perPage: number
): Promise<PatentsViewAssigneeHit[]> {
  const body = {
    q: { _text_phrase: { assignee_organization: organization } },
    f: ["assignee_id", "assignee_organization", "assignee_total_num_patents"],
    o: { per_page: Math.min(Math.max(perPage, 1), 100) },
    s: [{ assignee_total_num_patents: "desc" }],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch("https://api.patentsview.org/assignees/query", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PatentsView assignee search failed (${res.status}): ${t.slice(0, 280)}`);
  }

  const data = (await res.json()) as {
    assignees?: Array<{
      assignee_id?: string;
      assignee_organization?: string;
      assignee_total_num_patents?: number;
    }>;
  };

  return (data.assignees ?? []).map((a) => ({
    assigneeId: a.assignee_id ?? null,
    organization: a.assignee_organization ?? null,
    totalPatents: a.assignee_total_num_patents ?? null,
  }));
}

export async function searchPatentsViewPatentsByAssignee(
  apiKey: string,
  assigneeOrganization: string,
  perPage: number
): Promise<PatentsViewPatentHit[]> {
  const body = {
    q: { _text_phrase: { assignee_organization: assigneeOrganization } },
    f: ["patent_id", "patent_title", "patent_date", "assignees.assignee_organization"],
    o: { per_page: Math.min(Math.max(perPage, 1), 100) },
    s: [{ patent_date: "desc" }],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch("https://api.patentsview.org/patents/query", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PatentsView patent query failed (${res.status}): ${t.slice(0, 280)}`);
  }

  const data = (await res.json()) as {
    patents?: Array<{
      patent_id?: string;
      patent_title?: string;
      patent_date?: string;
      assignees?: Array<{ assignee_organization?: string }>;
    }>;
  };

  return (data.patents ?? []).map((p) => ({
    patentId: p.patent_id ?? null,
    title: p.patent_title ?? null,
    patentDate: p.patent_date ?? null,
    assignees: (p.assignees ?? []).map((a) => a.assignee_organization).filter(Boolean) as string[],
  }));
}

export async function fetchTsdrBySerial(
  apiKey: string,
  serialNumber: string
): Promise<TsdrTrademarkSummary> {
  const sn = serialNumber.replace(/\D/g, "");
  if (!sn) throw new Error("Serial number must contain digits.");

  const url = `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn${sn}/info.json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "USPTO-API-KEY": apiKey,
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`TSDR lookup failed (${res.status}): ${t.slice(0, 280)}`);
  }

  const data = (await res.json()) as {
    trademarkStatus?: {
      serialNumber?: string;
      registrationNumber?: string;
      markIdentification?: string;
      statusCode?: string;
      statusDate?: string;
      filingDate?: string;
      registrationDate?: string;
      ownerName?: string;
      goodsAndServices?: string;
    };
  };

  const tm = data.trademarkStatus;
  return {
    serialNumber: tm?.serialNumber ?? sn,
    registrationNumber: tm?.registrationNumber ?? null,
    mark: tm?.markIdentification ?? null,
    status: tm?.statusCode ?? null,
    statusDate: tm?.statusDate ?? null,
    filingDate: tm?.filingDate ?? null,
    registrationDate: tm?.registrationDate ?? null,
    owner: tm?.ownerName ?? null,
    goodsAndServices: tm?.goodsAndServices ?? null,
  };
}
