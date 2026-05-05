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
          "Public Records Profile",
          "Business Overview",
          "Recent Events",
          "Management & Board",
          "Business Model",
          "HowStuffWorks",
          "Company History",
          "Capital Allocation",
          "Credit Timeline",
          "Out-of-the-Box Ideas",
        ],
      },
    ],
  },
  "industry-competition": {
    groups: [
      {
        tabs: [
          "Porter's Five Forces",
          "Industry History and Drivers",
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
        tabs: ["SEC XBRL Financials", "Historical Financial Statements"],
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
          "Debt Footnote From 10K/Q",
          "Capital Structure",
          "Org Chart",
          "Credit Agreements & Indentures",
          "Entity Mapper",
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
          "Patent IP Filings",
          "Other Regulatory Filings",
        ],
      },
    ],
  },
  risk: {
    groups: [
      {
        label: "Desktop Risks",
        tabs: ["Risk from 10K"],
      },
      {
        label: "Claims",
        tabs: [
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
          "Industry Publications",
          "Industry Contacts",
          "Employee Contacts",
          "Dear Diary",
        ],
      },
      {
        tabs: [
          "News & Events",
          "Ratings Research Links",
          "Broker Research Reports",
          "The Cap Stack Rumor Mill",
          "Twitter Sentiment",
          "Substack",
        ],
      },
    ],
  },
  "work-product": {
    groups: [
      {
        tabs: [
          "KPI Commentary",
          "Forensic Analysis",
          "LME Analysis",
          "Recommendation",
          "AI Memo and Deck",
          "Literary References",
          "Biblical References",
        ],
      },
    ],
  },
};

export function getFirstTabIdForTopSection(topSection: CompanyTopSectionId): string {
  const firstLabel = companyNav[topSection]?.groups?.[0]?.tabs?.[0];
  return firstLabel ? tabLabelToId(firstLabel) : tabLabelToId("Public Records Profile");
}

