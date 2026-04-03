import type { BrokerDefinition } from "./types";
import { escapeGoogleQueryToken } from "./utils";

export type QueryContext = {
  ticker: string;
  companyName?: string;
  aliases: string[];
  from?: string;
  to?: string;
};

const KEYWORD_BLOCK =
  "(research OR report OR initiation OR upgrade OR downgrade OR \"target price\" OR \"price target\" OR preview OR recap OR analyst OR rating OR \"earnings\")";

function dateClause(from?: string, to?: string): string {
  const parts: string[] = [];
  if (from?.trim()) parts.push(`after:${from.trim().slice(0, 10)}`);
  if (to?.trim()) parts.push(`before:${to.trim().slice(0, 10)}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function coreEntity(ctx: QueryContext): string {
  const tk = ctx.ticker.trim().toUpperCase();
  const name = ctx.companyName?.trim();
  if (name) {
    const q = escapeGoogleQueryToken(name);
    return `("${q}" OR ${tk})`;
  }
  return tk;
}

/**
 * Broad, broker-scoped queries. Capped by caller via maxQueries.
 */
export function buildQueriesForBroker(
  broker: BrokerDefinition,
  ctx: QueryContext,
  maxQueries: number
): string[] {
  const domain = broker.domains[0];
  if (!domain) return [];

  const site = `site:${domain}`;
  const core = coreEntity(ctx);
  const dc = dateClause(ctx.from, ctx.to);
  const tk = ctx.ticker.trim().toUpperCase();
  const nameQ = ctx.companyName?.trim() ? `"${escapeGoogleQueryToken(ctx.companyName!)}"` : null;

  const aliasQueries: string[] = [];
  for (const a of ctx.aliases.slice(0, 2)) {
    const aq = escapeGoogleQueryToken(a);
    if (aq.length >= 2 && aq.toUpperCase() !== tk) {
      aliasQueries.push(`${site} ("${aq}" OR ${tk}) ${KEYWORD_BLOCK}${dc}`);
    }
  }

  const firmHint = broker.searchPatterns[0] ? ` "${escapeGoogleQueryToken(broker.searchPatterns[0])}"` : "";

  const templates: string[] = [
    `${site} ${core} ${KEYWORD_BLOCK}${dc}`,
    `${site} ${core} (sector OR industry OR thematic)${dc}`,
    nameQ ? `${site} ${nameQ} initiation${dc}` : `${site} ${tk} initiation${dc}`,
    nameQ ? `${site} ${nameQ} upgrade${dc}` : `${site} ${tk} upgrade${dc}`,
    nameQ ? `${site} ${nameQ} downgrade${dc}` : `${site} ${tk} downgrade${dc}`,
    nameQ ? `${site} ${nameQ} "target price"${dc}` : `${site} ${tk} "price target"${dc}`,
    nameQ ? `${site} ${nameQ} "earnings preview"${dc}` : `${site} ${tk} "earnings preview"${dc}`,
    nameQ ? `${site} ${nameQ} recap OR "post-earnings"${dc}` : `${site} ${tk} recap OR "post-earnings"${dc}`,
    `${site} ${core} ("company update" OR "rating change")${dc}`,
    `${site} ${core} (portal OR login OR client)${dc}`,
    `${site} ${core} (insight OR views OR analysis)${firmHint}${dc}`,
    ...aliasQueries,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of templates) {
    const k = q.replace(/\s+/g, " ").trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= maxQueries) break;
  }

  return out;
}
