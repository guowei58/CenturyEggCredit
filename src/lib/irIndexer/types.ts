export type IrAssetType =
  | "pdf"
  | "sec_filing"
  | "press_release"
  | "presentation"
  | "transcript"
  | "webcast"
  | "annual_report"
  | "quarterly_report"
  | "governance"
  | "event"
  | "html_page"
  | "other";

export type IrIngestionStatus = "queued" | "running" | "completed" | "failed";

export type IrSource = {
  id: string;
  ticker: string;
  root_url: string;
  company_name: string | null;
  cik: string | null;
  status: IrIngestionStatus;
  last_indexed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IrPage = {
  id: string;
  ir_source_id: string;
  url: string;
  canonical_url: string | null;
  title: string | null;
  meta_description: string | null;
  depth: number;
  fetched_at: string;
  content_hash: string;
  raw_text_excerpt: string;
  render_status: "ok" | "timeout" | "error";
  final_url: string;
};

export type IrSection = {
  id: string;
  ir_page_id: string;
  parent_section_id: string | null;
  heading: string | null;
  level: number;
  order_index: number;
  text_content: string;
};

export type IrAsset = {
  id: string;
  ir_source_id: string;
  ir_page_id: string | null;
  ir_section_id: string | null;
  url: string;
  normalized_url: string;
  title: string | null;
  asset_type: IrAssetType;
  file_extension: string | null;
  source_type: "link" | "iframe" | "button" | "sec_enrichment";
  hostname: string;
  anchor_text: string | null;
  context_text: string | null;
  published_at: string | null;
  is_same_domain: boolean;
  is_from_sec: boolean;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type IrIngestionJob = {
  id: string;
  ir_source_id: string;
  status: IrIngestionStatus;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  pages_scanned: number;
  assets_found: number;
};

export type IndexedIrSummary = {
  source: IrSource;
  pagesIndexed: number;
  assetsFound: number;
  assetsByType: Record<IrAssetType, number>;
};

