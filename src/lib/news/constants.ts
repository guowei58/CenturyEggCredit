/** Ids matching `NEWS_PROVIDER_REGISTRATIONS` — safe to import from client components. */
export const PRODUCTION_NEWS_PROVIDER_IDS = ["major_outlet_rss"] as const;

export type ProductionNewsProviderId = (typeof PRODUCTION_NEWS_PROVIDER_IDS)[number];

/** Google News RSS relative lookback for major-outlet search (~2 years). */
export const MAJOR_OUTLET_GOOGLE_NEWS_WHEN = "730d";
