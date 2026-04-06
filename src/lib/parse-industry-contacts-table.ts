export type ParsedIndustryContactRow = {
  name: string;
  whyRelevant: string;
  relationship: string;
  linkedinUrl: string | null;
};

/** Text for [function/business area] in the outreach letter. */
export function industryContactPositionLine(c: ParsedIndustryContactRow): string {
  const { whyRelevant, relationship } = c;
  if (whyRelevant && relationship) return `${whyRelevant} — ${relationship}`;
  return whyRelevant || relationship || "";
}

/**
 * Industry Contacts HTML table: Name | Why Relevant | Relationship | LinkedIn.
 */
export function parseIndustryContactsTable(html: string): ParsedIndustryContactRow[] {
  if (!html?.trim()) return [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tables = doc.querySelectorAll("table");
    const out: ParsedIndustryContactRow[] = [];

    for (const table of Array.from(tables)) {
      let rows = table.querySelectorAll("tbody tr");
      if (rows.length === 0) {
        rows = table.querySelectorAll("tr");
      }

      for (const row of Array.from(rows)) {
        if (row.querySelector("th")) continue;
        const cells = row.querySelectorAll("td");
        if (cells.length < 4) continue;

        const name = cells[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const whyRelevant = cells[1]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const relationship = cells[2]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const link = cells[3]?.querySelector("a[href]");
        const href = link?.getAttribute("href")?.trim() ?? "";

        let linkedinUrl: string | null = null;
        if (href && /^https?:\/\/([\w.-]+\.)?linkedin\.com\//i.test(href)) {
          linkedinUrl = href;
        }

        if (!name && !linkedinUrl) continue;
        out.push({ name: name || "Unknown", whyRelevant, relationship, linkedinUrl });
      }
    }

    return out;
  } catch {
    return [];
  }
}
