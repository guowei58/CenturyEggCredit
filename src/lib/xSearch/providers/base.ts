import { loadXSearchConfigFromEnv } from "../config";

export function requireBearerToken(): string {
  const cfg = loadXSearchConfigFromEnv();
  const t = cfg.bearerToken;
  if (!t) throw new Error("X_BEARER_TOKEN is not set");
  return t;
}

