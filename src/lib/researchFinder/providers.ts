import type { ResearchProviderId } from "./types";

export type ProviderDef = {
  id: ResearchProviderId;
  name: string;
  enabledByDefault: boolean;
  domains: string[]; // allowlist
  importantPaths?: string[]; // boosts
};

export const PROVIDERS: ProviderDef[] = [
  { id: "octus", name: "Octus", enabledByDefault: true, domains: ["octus.com"] },
  { id: "creditsights", name: "CreditSights", enabledByDefault: true, domains: ["creditsights.com", "know.creditsights.com"] },
  { id: "9fin", name: "9fin", enabledByDefault: true, domains: ["9fin.com", "public-content.9fin.com"] },
  { id: "debtwire", name: "Debtwire", enabledByDefault: true, domains: ["debtwire.com", "info.debtwire.com", "ionanalytics.com"] },
  {
    id: "wsj_bankruptcy",
    name: "WSJ Pro Bankruptcy",
    enabledByDefault: true,
    domains: ["wsj.com"],
    importantPaths: ["/pro/bankruptcy", "/news/types/pro-bankruptcy-bankruptcy"],
  },
];

export function getProviderById(id: ResearchProviderId): ProviderDef | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

