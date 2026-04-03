const FINANCE_TERMS = [
  "earnings",
  "credit",
  "bonds",
  "distressed",
  "rating",
  "upgrade",
  "downgrade",
  "refinancing",
  "default",
  "bankruptcy",
];

function q(s: string): string {
  return `"${s.replace(/"/g, "").trim()}"`;
}

export function buildDiscoveryQueries(params: {
  ticker: string;
  companyName?: string;
  aliases: string[];
}): string[] {
  const tk = params.ticker.trim().toUpperCase();
  const name = params.companyName?.trim();
  const aliases = (params.aliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 4);

  const entity: string[] = [q(tk)];
  if (name) entity.push(q(name));
  for (const a of aliases) entity.push(q(a));

  const core = `(${entity.join(" OR ")})`;
  const finance = `(${FINANCE_TERMS.join(" OR ")})`;

  const templates = [
    `${core} (site:substack.com OR Substack)`,
    `${core} (Substack OR newsletter)`,
    `${core} ${finance} (Substack OR newsletter)`,
    name ? `${q(name)} site:substack.com` : `${q(tk)} site:substack.com`,
    `${q(tk)} site:substack.com`,
    `${core} ("published on Substack" OR "Substack")`,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of templates) {
    const k = t.replace(/\s+/g, " ").trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

