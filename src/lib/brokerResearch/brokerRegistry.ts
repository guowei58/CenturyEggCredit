import { PRODUCTION_BROKER_IDS } from "./constants";
import { MOCK_BROKER_DEFINITION } from "./brokers/mockBroker";
import { BROKER_REGISTRY_ENTRIES } from "./brokers/registryEntries";
import type { BrokerDefinition } from "./types";

const byId = new Map<string, BrokerDefinition>();
for (const b of BROKER_REGISTRY_ENTRIES) {
  byId.set(b.id, b);
}

/** Validates catalog ids match constants (single source for client-safe ids). */
export function assertCatalogMatchesConstants(): void {
  const catalog = new Set(BROKER_REGISTRY_ENTRIES.map((b) => b.id));
  const expected = new Set(PRODUCTION_BROKER_IDS as unknown as string[]);
  if (
    catalog.size !== expected.size ||
    !Array.from(expected).every((id) => catalog.has(id))
  ) {
    throw new Error("brokerResearch: PRODUCTION_BROKER_IDS out of sync with BROKER_REGISTRY_ENTRIES");
  }
}

export function getAllBrokerDefinitions(): BrokerDefinition[] {
  return [...BROKER_REGISTRY_ENTRIES];
}

export function getBrokerById(id: string): BrokerDefinition | undefined {
  return byId.get(id);
}

export function getProductionBrokerIds(): string[] {
  return [...PRODUCTION_BROKER_IDS];
}

export { MOCK_BROKER_DEFINITION };
