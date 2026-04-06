import type { EchoFacilityRaw } from "@/lib/env-risk/types";

/**
 * RCRA / hazardous-waste signals for v1 are derived from ECHO all-media facility rows
 * (RCRAComplianceStatus, RCRA flags, etc.) — no separate RCRA Info API call yet.
 */
export function rcraSignalsFromEchoRow(row: EchoFacilityRaw): string[] {
  const flags: string[] = [];
  const rc = (row.RCRAComplianceStatus || "").trim();
  if (rc && !/no violation/i.test(rc)) flags.push(`RCRA: ${rc}`);
  const hist = (row.RCRA3yrComplQtrsHistory || "").trim();
  if (hist && /[^_\s]/.test(hist)) flags.push("RCRA 3yr quarter history present");
  const ico = (row.FacMapIcon || "").toLowerCase();
  if (ico.includes("rcra")) flags.push("ECHO map icon indicates RCRA program");
  return flags;
}
