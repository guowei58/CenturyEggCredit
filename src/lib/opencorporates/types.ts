export type OpenCorporatesCompanyHit = {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  inactive?: boolean;
  current_status?: string | null;
  registered_address_in_full?: string | null;
  opencorporates_url?: string | null;
  registry_url?: string | null;
  incorporation_date?: string | null;
  previous_names?: unknown;
};

export type OpenCorporatesSearchMeta = {
  apiEndpoint: string;
  query: string;
  jurisdictionFilter: string | null;
  responseAt: string;
  resultCount: number;
  totalPages?: number;
  page?: number;
  raw: Record<string, unknown>;
};
