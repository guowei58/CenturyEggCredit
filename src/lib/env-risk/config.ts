import { oreoUserAgent } from "@/lib/branding";

export type EnvRiskRuntimeConfig = {
  secUserAgent: string;
  epaUserAgent: string;
  cacheTtlMs: number;
  echoEnabled: boolean;
  envirofactsEnabled: boolean;
  rcraEchoFieldsEnabled: boolean;
  stateConnectorsEnabled: boolean;
  maxFilingFetches: number;
  echoPageSize: number;
  maxFrsQueries: number;
  maxEchoNameQueries: number;
  requestTimeoutMs: number;
};

export function getEnvRiskConfig(): EnvRiskRuntimeConfig {
  const secUa = process.env.SEC_EDGAR_USER_AGENT?.trim();
  return {
    secUserAgent: secUa && secUa.length > 8 ? secUa : oreoUserAgent("SEC EDGAR"),
    epaUserAgent: process.env.EPA_HTTP_USER_AGENT?.trim() || oreoUserAgent("EPA public data"),
    cacheTtlMs: Math.max(60_000, parseInt(process.env.ENV_RISK_CACHE_TTL_MS || "86400000", 10) || 86_400_000),
    echoEnabled: process.env.ENV_RISK_ENABLE_ECHO !== "false",
    envirofactsEnabled: process.env.ENV_RISK_ENABLE_ENVIROFACTS !== "false",
    rcraEchoFieldsEnabled: process.env.ENV_RISK_ENABLE_RCRA !== "false",
    stateConnectorsEnabled: process.env.ENV_RISK_ENABLE_STATE_CONNECTORS === "true",
    maxFilingFetches: Math.min(24, Math.max(4, parseInt(process.env.ENV_RISK_MAX_FILING_FETCHES || "12", 10) || 12)),
    echoPageSize: Math.min(100, Math.max(5, parseInt(process.env.ENV_RISK_ECHO_PAGE_SIZE || "25", 10) || 25)),
    maxFrsQueries: Math.min(12, Math.max(2, parseInt(process.env.ENV_RISK_MAX_FRS_QUERIES || "6", 10) || 6)),
    maxEchoNameQueries: Math.min(6, Math.max(1, parseInt(process.env.ENV_RISK_MAX_ECHO_QUERIES || "3", 10) || 3)),
    requestTimeoutMs: Math.min(120_000, Math.max(8_000, parseInt(process.env.ENV_RISK_REQUEST_TIMEOUT_MS || "45000", 10) || 45_000)),
  };
}
