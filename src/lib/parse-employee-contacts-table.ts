export type ParsedEmployeeContactRow = {
  name: string;
  position: string;
  linkedinUrl: string | null;
};

/**
 * Best-effort parse of the Employee Contacts HTML table (Name | Position | LinkedIn).
 */
export function parseEmployeeContactsTable(html: string): ParsedEmployeeContactRow[] {
  if (!html?.trim()) return [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tables = doc.querySelectorAll("table");
    const out: ParsedEmployeeContactRow[] = [];

    for (const table of Array.from(tables)) {
      let rows = table.querySelectorAll("tbody tr");
      if (rows.length === 0) {
        rows = table.querySelectorAll("tr");
      }

      for (const row of Array.from(rows)) {
        if (row.querySelector("th")) continue;
        const cells = row.querySelectorAll("td");
        if (cells.length < 3) continue;

        const name = cells[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const position = cells[1]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const link = cells[2]?.querySelector("a[href]");
        const href = link?.getAttribute("href")?.trim() ?? "";

        let linkedinUrl: string | null = null;
        if (href && /^https?:\/\/([\w.-]+\.)?linkedin\.com\//i.test(href)) {
          linkedinUrl = href;
        }

        if (!name && !linkedinUrl) continue;
        out.push({ name: name || "Unknown", position, linkedinUrl });
      }
    }

    return out;
  } catch {
    return [];
  }
}
