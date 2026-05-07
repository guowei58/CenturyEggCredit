import { formatOutboundFetchError } from "@/lib/opencorporates/formatFetchError";
import { ocThrottle } from "@/lib/opencorporates/rateLimitedFetch";
import { formatGleifPostalAddress } from "@/lib/gleif/formatGleifAddress";
import type { OpenCorporatesCompanyHit } from "@/lib/opencorporates/types";

const API_ROOT = "https://api.gleif.org/api/v1/lei-records";

type GleifJsonApiResource = {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  links?: { self?: string };
};

type GleifSearchResponse = {
  meta?: { pagination?: { total?: number; perPage?: number; currentPage?: number } };
  data?: GleifJsonApiResource[];
};

function gleifEntityInactive(
  entity: { status?: string } | undefined,
  registration: { status?: string } | undefined
): boolean {
  const reg = (registration?.status ?? "").toUpperCase();
  if (reg === "RETIRED" || reg === "ANNULLED") return true;
  const st = (entity?.status ?? "").toUpperCase();
  if (!st) return false;
  return st !== "ACTIVE";
}

function recordToHit(rec: GleifJsonApiResource): OpenCorporatesCompanyHit | null {
  const attrs = rec.attributes as
    | {
        lei?: string;
        entity?: {
          legalName?: { name?: string };
          legalAddress?: Parameters<typeof formatGleifPostalAddress>[0];
          jurisdiction?: string;
          status?: string;
          registeredAs?: string | null;
        };
        registration?: {
          validatedAs?: string | null;
          status?: string;
        };
      }
    | undefined;

  const lei = attrs?.lei ?? rec.id;
  const legalName = attrs?.entity?.legalName?.name?.trim();
  if (!lei || !legalName) return null;

  const legalAddr = formatGleifPostalAddress(attrs?.entity?.legalAddress);
  const jurisdiction = (attrs?.entity?.jurisdiction ?? "").trim() || "ZZ";
  const regId =
    (attrs?.registration?.validatedAs != null && String(attrs.registration.validatedAs).trim()) ||
    (attrs?.entity?.registeredAs != null && String(attrs.entity.registeredAs).trim()) ||
    "";

  const entStatus = attrs?.entity?.status ?? "";
  const regStatus = attrs?.registration?.status ?? "";
  const currentStatus = [entStatus, regStatus].filter(Boolean).join(" · ");

  const selfLink =
    typeof rec.links?.self === "string" ? rec.links.self : `https://api.gleif.org/api/v1/lei-records/${lei}`;

  return {
    name: legalName,
    company_number: regId || lei,
    jurisdiction_code: jurisdiction,
    inactive: gleifEntityInactive(attrs?.entity, attrs?.registration),
    current_status: currentStatus || null,
    registered_address_in_full: legalAddr || null,
    opencorporates_url: `https://search.gleif.org/#/record/${encodeURIComponent(lei)}`,
    registry_url: selfLink,
  };
}

export async function searchGleifLeiRecords(params: {
  legalName: string;
  /** GLEIF `entity.jurisdiction` e.g. `US-DE`, `GB`, `JP` */
  gleifJurisdiction: string | null;
  pageSize?: number;
}): Promise<
  | {
      ok: true;
      meta: {
        apiEndpoint: string;
        query: string;
        jurisdictionFilter: string | null;
        responseAt: string;
        resultCount: number;
        raw: Record<string, unknown>;
      };
      companies: OpenCorporatesCompanyHit[];
    }
  | { ok: false; status: number; bodySnippet: string }
> {
  const pageSize = params.pageSize ?? 50;
  const u = new URL(API_ROOT);
  u.searchParams.set("filter[entity.legalName]", params.legalName.trim());
  if (params.gleifJurisdiction?.trim()) {
    u.searchParams.set("filter[entity.jurisdiction]", params.gleifJurisdiction.trim());
  }
  u.searchParams.set("page[size]", String(Math.min(100, Math.max(1, pageSize))));

  await ocThrottle();

  let res: Response;
  try {
    res = await fetch(u.toString(), {
      method: "GET",
      headers: {
        Accept: "application/vnd.api+json",
        "User-Agent": "CenturyEggCredit/1.0 (GLEIF subsidiary address finder)",
      },
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      bodySnippet: formatOutboundFetchError(e, "GLEIF API").message,
    };
  }

  const responseAt = new Date().toISOString();
  const text = await res.text();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      status: res.status,
      bodySnippet: text.slice(0, 400) || `HTTP ${res.status}`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      bodySnippet: text.slice(0, 400) || `HTTP ${res.status}`,
    };
  }

  const parsed = raw as GleifSearchResponse;
  const companies: OpenCorporatesCompanyHit[] = [];
  for (const item of parsed.data ?? []) {
    const hit = recordToHit(item);
    if (hit) companies.push(hit);
  }

  const total = parsed.meta?.pagination?.total ?? companies.length;
  const meta = {
    apiEndpoint: u.toString(),
    query: params.legalName.trim(),
    jurisdictionFilter: params.gleifJurisdiction?.trim() ?? null,
    responseAt,
    resultCount: total,
    raw,
  };

  return { ok: true, meta, companies };
}
