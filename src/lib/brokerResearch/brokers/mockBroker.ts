import type { BrokerDefinition } from "../types";

/** Test-only broker — use with injected mock search provider returning example.test URLs. */
export const MOCK_BROKER_DEFINITION: BrokerDefinition = {
  id: "mock_broker",
  name: "Mock Broker (tests)",
  /** True so tests can pass `[MOCK_BROKER_DEFINITION]` without env; not in production registry. */
  enabledByDefault: true,
  domains: ["example.test", "broker.test"],
  aliases: ["Mock Research"],
  searchPatterns: ["mock research"],
  urlHints: ["/reports"],
};
