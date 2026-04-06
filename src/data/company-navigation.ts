import { tabLabelToId } from "@/lib/tabs";

export type CompanyTopSectionId =
  | "overview"
  | "industry-competition"
  | "financials"
  | "roic-ai"
  | "capital-structure"
  | "documents"
  | "risk"
  | "research"
  | "work-product";

/** Sections shown in the company analysis top nav. (`roic-ai` is omitted on purpose; see `companyNav["roic-ai"]`.) */
export const companyTopSections: Array<{ id: CompanyTopSectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "industry-competition", label: "Industry & Competition" },
  { id: "financials", label: "Financials" },
  { id: "capital-structure", label: "Capital Structure" },
  { id: "documents", label: "Documents" },
  { id: "risk", label: "Risk" },
  { id: "research", label: "Research" },
  { id: "work-product", label: "Work Product" },
];

type NavGroup = { label?: string; tabs: string[] };
type NavDefinition = { groups: NavGroup[] };

// Tab labels map to existing tab IDs via tabLabelToId().
export const companyNav: Record<CompanyTopSectionId, NavDefinition> = {
  overview: {
    groups: [
      {
        tabs: [
          "Business Overview",
          "Management & Board",
          "Business Model",
          "Company History",
          "Capital Allocation",
          "Credit Timeline",
          "Out-of-the-Box Ideas",
          "IR Page Indexer",
        ],
      },
    ],
  },
  "industry-competition": {
    groups: [
      {
        tabs: [
          "Porter's Five Forces",
          "Industry Value Chain",
          "Competitors",
          "Customers",
          "Suppliers",
          "Startup Risks",
        ],
      },
    ],
  },
  financials: {
    groups: [
      {
        tabs: [
          "Historical Financial Statements",
          "KPI",
          "SEC XBRL Financials",
          "Working Capital",
          "Liquidity Analysis",
          "Recovery Analysis",
          "Comps",
        ],
      },
    ],
  },
  "roic-ai": {
    groups: [
      {
        tabs: ["Annual Financial Statements", "Quarterly Financial Statements", "Earnings call transcripts"],
      },
    ],
  },
  "capital-structure": {
    groups: [
      {
        tabs: [
          "Capital Structure",
          "Org Chart",
          "Credit Agreements & Indentures",
          "Subsidiary List",
          "LME Analysis",
        ],
      },
    ],
  },
  documents: {
    groups: [
      {
        // "EdgarTools SEC" intentionally omitted from nav for now; CompanyEdgarToolsTab + /api/edgartools/* remain.
        tabs: [
          "Saved Documents",
          "SEC Filings",
          "FCC Filings",
          "Other Regulatory Filings",
          "Trademark IP Filings",
        ],
      },
    ],
  },
  risk: {
    groups: [
      {
        label: "Claims",
        tabs: [
          "Risk from 10K",
          "Environmental Claims",
          "Litigation Claims",
          "Labor/Pension Claims",
          "Tax Claims",
          "Regulatory Claims",
          "Lease Claims",
          "Trade/Supply Chain Claims",
        ],
      },
      {
        label: "Fraud Checks / Diligence",
        tabs: [
          "Forensic Accounting",
          "Entity Searches",
          "Liens",
          "Management Background Check",
          "Legal Searches",
          "Related Party Checks",
        ],
      },
    ],
  },
  research: {
    groups: [
      {
        tabs: [
          "Research Roadmap",
          "Earnings Releases",
          "Mgmt Presentations & Transcripts",
          "News & Events",
          "Industry Publications",
          "Ratings Research Links",
          "Broker Research Reports",
          "The Cap Stack Rumor Mill",
          "Reddit",
          "Twitter Sentiment",
          "Substack",
          "Industry Contacts",
          "Employee Contacts",
          "Dear Diary",
        ],
      },
    ],
  },
  "work-product": {
    groups: [
      {
        tabs: [
          "Recommendation",
          "AI Memo and Deck",
          "Pre-Mortem Analysis",
          "Literary References",
          "Biblical References",
          "Jokes",
        ],
      },
    ],
  },
};

export function getFirstTabIdForTopSection(topSection: CompanyTopSectionId): string {
  const firstLabel = companyNav[topSection]?.groups?.[0]?.tabs?.[0];
  return firstLabel ? tabLabelToId(firstLabel) : tabLabelToId("Business Overview");
}

