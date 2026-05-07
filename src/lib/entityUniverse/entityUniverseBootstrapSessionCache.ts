import type { TaxLienSourceMatrixRow } from "@/lib/taxLien/taxLienMatrixShared";

/** Exhibit 21 bootstrap payload subset stored per ticker for SPA session (Public Records embed). */
export type EntityUniverseBootstrapSnapshot = {
  entityIntelProfile: Record<string, unknown> | null;
  taxLienStateSources: TaxLienSourceMatrixRow[];
  data: Record<string, unknown[]>;
};

const cache = new Map<string, EntityUniverseBootstrapSnapshot>();

export function readEntityUniverseBootstrapSessionCache(ticker: string): EntityUniverseBootstrapSnapshot | undefined {
  return cache.get(ticker.trim().toUpperCase());
}

export function writeEntityUniverseBootstrapSessionCache(ticker: string, snapshot: EntityUniverseBootstrapSnapshot): void {
  cache.set(ticker.trim().toUpperCase(), snapshot);
}
