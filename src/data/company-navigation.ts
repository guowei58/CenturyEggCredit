import { tabLabelToId } from "@/lib/tabs";

export type CompanyTopSectionId =
  | "overview"
  | "industry-competition"
  | "financials"
  | "capital-structure"
  | "documents"
  | "risk"
  | "research"
  | "work-product";

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
          "Credit Timeline",
          "Out-of-the-Box Ideas",
          "Research Roadmap",
          "IR Page Indexer",
        ],
      },
    ],
  },
  "industry-competition": {
    groups: [
      {
        tabs: ["Porter's Five Forces", "Competitors", "Customers", "Suppliers", "Startup Risks"],
      },
    ],
  },
  financials: {
    groups: [
      {
        tabs: [
          "Historical Financial Statements",
          "20 year GAAP Net Income",
          "Working Capital",
          "Liquidity Analysis",
          "Recovery Analysis",
          "Comps",
        ],
      },
    ],
  },
  "capital-structure": {
    groups: [
      {
        tabs: ["Capital Structure", "Org Chart", "Credit Agreements & Indentures", "Subsidiary List"],
      },
    ],
  },
  documents: {
    groups: [
      {
        tabs: [
          "Saved Documents",
          "SEC Filings",
          "FCC Filings",
          "Other Regulatory Filings",
          "Trademark IP Filings",
          "Earnings Releases",
          "Mgmt Presentations",
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
          "Ways to Get Screwed",
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
          "Management & Governance Diligence",
          "Legal Searches",
          "Channel Checks",
          "Ex-Employee Checks",
          "Related Party Checks",
        ],
      },
    ],
  },
  research: {
    groups: [
      {
        tabs: [
          "News & Events",
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
          "AI Memo and Deck",
          "Pre-Mortem Analysis",
          "Literary References",
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

