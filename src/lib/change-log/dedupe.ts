export function changeLogDedupeKey(url: string, accessionNumber?: string): string {
  const acc = accessionNumber?.trim();
  if (acc) return `sec:${acc.replace(/\s+/g, "")}`;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return `url:${u.toString().toLowerCase()}`;
  } catch {
    return `url:${url.trim().toLowerCase()}`;
  }
}
